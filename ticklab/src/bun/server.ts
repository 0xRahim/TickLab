import { join, normalize, sep } from "node:path";
import { openDb } from "./db";
import { downloadSession, getAllCoverage, isSupportedInterval, isSupportedSymbol, SUPPORTED_SYMBOLS } from "./download";
import { HISTDATA_SOURCE_TZ, createHistImport, importHistDataText, normalizeSymbol, type HistImportSession } from "./histdata";
import { queryLocalCandles } from "./local-candles";

const PORT = Number(Bun.env.TICKLAB_PORT ?? 4578);
// Dev: point at `next dev` (TICKLAB_WEB_URL=http://localhost:3000).
// Packaged app: backend serves the static Next export itself (same origin).
const WEB_URL = Bun.env.TICKLAB_WEB_URL?.trim() || `http://127.0.0.1:${PORT}/`;

function resolveWebDir(): string {
  const candidates = [
    Bun.env.TICKLAB_WEB_DIR?.trim(),
    join(process.cwd(), "web", "out"),
    join(process.cwd(), "Resources", "app", "web", "out"),
    join(normalize(process.execPath + sep + ".."), "web", "out"),
    join(normalize(process.execPath + sep + ".."), "Resources", "app", "web", "out"),
    join(normalize(process.execPath + sep + ".."), "..", "Resources", "app", "web", "out"),
  ].filter((p): p is string => !!p);
  for (const dir of candidates) {
    try {
      if (Bun.file(join(dir, "index.html")).size > 0) return dir;
    } catch {
      /* try next */
    }
  }
  return candidates[1]!;
}
const WEB_DIR = resolveWebDir();

const db = openDb();

// In-progress GUI bulk imports: one streaming `HistImportSession` per job
// so sequential chunk uploads share cross-file resample carry (same as CLI).
interface ImportJob {
  id: string;
  symbol: string;
  tz: string;
  fileNames: string[];
  total: number;
  session: HistImportSession;
  startedAt: number;
}
const importJobs = new Map<string, ImportJob>();

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function sessionDetail(id: string) {
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!s) return null;
  const instruments = db.prepare("SELECT symbol, timeframe AS interval, from_iso AS `from`, to_iso AS `to`, cached_bars, status, error FROM session_instruments WHERE session_id = ?").all(id);
  return { ...s, instruments };
}

async function serveStatic(pathname: string): Promise<Response | null> {
  try {
    let rel = decodeURIComponent(pathname);
    if (!rel.startsWith("/") || rel.includes("\0")) return null;
    if (rel.endsWith("/")) rel += "index.html";
    let abs = normalize(join(WEB_DIR, rel));
    if (abs !== WEB_DIR && !abs.startsWith(WEB_DIR + sep)) return null;
    let file = Bun.file(abs);
    if (!(await file.exists())) {
      // Extensionless route (e.g. `/session`) → trailing-slash export.
      const nested = normalize(join(WEB_DIR, rel, "index.html"));
      if (nested.startsWith(WEB_DIR + sep)) file = Bun.file(nested);
    }
    if (!(await file.exists())) return null;
    return new Response(file);
  } catch {
    return null;
  }
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return json({}, 204);
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (!pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return err("Not found.", 404);
    // Packaged app: serve the static Next.js export (same origin as API).
    // Dev with `next dev`: TICKLAB_WEB_URL points at localhost:3000 instead.
    if (!Bun.env.TICKLAB_WEB_URL?.trim()) {
      const staticRes = await serveStatic(pathname);
      if (staticRes) return staticRes;
    }
    return err("Not found.", 404);
  }

  // ── Health + symbols ──────────────────────────────────────────────
  if (pathname === "/api/health" && method === "GET") return json({ ok: true, service: "ticklab" });
  if (pathname === "/api/symbols" && method === "GET") {
    return json({
      symbols: SUPPORTED_SYMBOLS.map((s) => ({
        symbol: s,
        description: s,
        exchange: s === "BTCUSD" ? "CRYPTO" : "FX",
      })),
    });
  }

  // ── Local data coverage (what's imported, per symbol × interval) ──────
  if (pathname === "/api/coverage" && method === "GET") {
    return json({ coverage: getAllCoverage(db) });
  }

  // ── CSV import (GUI job upload; same streaming core as the CLI) ──────
  // Bulk flow: POST /api/import/start {symbol, fileNames[]} → sequential
  // POST /api/import/chunk (jobId + index + file, filename-sorted, any size)
  // → POST /api/import/finish {jobId}. Single-file top-ups can still use
  // POST /api/import directly (no size cap — desktop app).
  if (pathname === "/api/import" && method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err("Expected a multipart form with fields symbol + file (CSV).");
    }
    const symbol = normalizeSymbol(String(form.get("symbol") ?? ""));
    if (!isSupportedSymbol(symbol)) return err("Unknown symbol.");
    const file = form.get("file");
    if (!(file instanceof File)) return err("Missing CSV file field 'file'.");
    const text = await file.text();
    if (!text.trim()) return err("Empty file.");
    const tz = String(form.get("tz") ?? "").trim() || HISTDATA_SOURCE_TZ;
    try {
      const summary = importHistDataText(db, symbol, text, { sourceTz: tz });
      return json({ symbol, ...summary }, 201);
    } catch (e) {
      return err(e instanceof Error ? e.message : "Import failed.", 422);
    }
  }

  if (pathname === "/api/import/start" && method === "POST") {
    let body: { symbol?: unknown; tz?: unknown; fileNames?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return err("Invalid JSON body. Expected { symbol, fileNames }.");
    }
    const symbol = normalizeSymbol(String(body.symbol ?? ""));
    if (!isSupportedSymbol(symbol)) return err("Unknown symbol.");
    const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map(String) : [];
    if (fileNames.length === 0 || fileNames.length > 5000) {
      return err("fileNames must be a non-empty array (max 5000) of CSV file names in upload order.");
    }
    const tz = typeof body.tz === "string" && body.tz.trim() ? body.tz.trim() : HISTDATA_SOURCE_TZ;
    // Sweep stale jobs (older than 2h) so abandoned uploads can't leak.
    const cutoff = Date.now() - 2 * 3600 * 1000;
    for (const [id, job] of importJobs) {
      if (job.startedAt < cutoff) importJobs.delete(id);
    }
    const jobId = crypto.randomUUID();
    importJobs.set(jobId, {
      id: jobId,
      symbol,
      tz,
      fileNames,
      total: fileNames.length,
      session: createHistImport(db, symbol, { sourceTz: tz }),
      startedAt: Date.now(),
    });
    return json({ jobId, symbol, total: fileNames.length }, 201);
  }

  if (pathname === "/api/import/chunk" && method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err("Expected a multipart form with fields jobId + index + file.");
    }
    const jobId = String(form.get("jobId") ?? "");
    const job = importJobs.get(jobId);
    if (!job) return err("Unknown or expired import job. Start a new import.", 404);
    const index = Number(form.get("index"));
    const expected = job.session.progress().files;
    if (!Number.isInteger(index) || index !== expected) {
      return err(`Out-of-order chunk: expected index ${expected}. Upload files sequentially in filename-sorted order.`);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return err("Missing CSV file field 'file'.");
    const text = await file.text();
    if (!text.trim()) return err("Empty file.");
    try {
      job.session.appendText(text);
    } catch (e) {
      return err(e instanceof Error ? e.message : "Import failed.", 422);
    }
    const p = job.session.progress();
    return json({ jobId, symbol: job.symbol, done: p.files, total: job.total, m1Bars: p.m1Bars, skipped: p.skipped });
  }

  if (pathname === "/api/import/finish" && method === "POST") {
    let body: { jobId?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return err("Invalid JSON body. Expected { jobId }.");
    }
    const jobId = String(body.jobId ?? "");
    const job = importJobs.get(jobId);
    if (!job) return err("Unknown or expired import job. Start a new import.", 404);
    const p = job.session.progress();
    if (p.files < job.total) {
      return err(`Incomplete import: received ${p.files} of ${job.total} files. Upload the remaining files first.`);
    }
    let summary;
    try {
      summary = job.session.finish();
    } catch (e) {
      return err(e instanceof Error ? e.message : "Import failed.", 422);
    }
    importJobs.delete(jobId);
    return json({ jobId, symbol: job.symbol, ...summary }, 201);
  }

  const importJobMatch = pathname.match(/^\/api\/import\/([^/]+)$/);
  if (importJobMatch) {
    const jobId = importJobMatch[1]!;
    const job = importJobs.get(jobId);
    if (!job) return err("Unknown or expired import job.", 404);
    if (method === "GET") {
      const p = job.session.progress();
      return json({ jobId, symbol: job.symbol, done: p.files, total: job.total, m1Bars: p.m1Bars, skipped: p.skipped });
    }
    if (method === "DELETE") {
      // Discard without finish(): trailing HTF partial buckets stay
      // unflushed; already-upserted bars remain and re-imports are safe.
      importJobs.delete(jobId);
      return json({ ok: true, jobId });
    }
    return err("Not found.", 404);
  }

  // ── Sessions CRUD ─────────────────────────────────────────────────
  if (pathname === "/api/sessions" && method === "GET") {
    const rows = db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
    return json({
      sessions: (rows as Array<{ id: string }>).map((r) => sessionDetail(r.id)),
    });
  }

  if (pathname === "/api/sessions" && method === "POST") {
    let body: { name?: unknown; symbols?: unknown; timeframes?: unknown; from?: unknown; to?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return err("Invalid JSON body.");
    }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Untitled session";
    const symbols = Array.isArray(body.symbols) ? body.symbols.map(String).map((s) => s.toUpperCase()).filter(isSupportedSymbol) : [];
    const timeframes = Array.isArray(body.timeframes) ? body.timeframes.map(String).filter(isSupportedInterval) : [];
    const fromMs = typeof body.from === "string" ? Date.parse(body.from) : NaN;
    const toMs = typeof body.to === "string" ? Date.parse(body.to) : NaN;
    if (symbols.length === 0) return err("Select at least one instrument.");
    if (timeframes.length === 0) return err("Select at least one timeframe.");
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      return err("Invalid from/to. Use ISO timestamps with from < to.");
    }
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const create = db.transaction(() => {
      db.prepare("INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)").run(id, name, now, now);
      for (const symbol of symbols) {
        for (const tf of timeframes) {
          db.prepare(
            "INSERT INTO session_instruments (session_id, symbol, timeframe, from_iso, to_iso) VALUES (?, ?, ?, ?, ?)",
          ).run(id, symbol, tf, fromIso, toIso);
        }
      }
    });
    create();
    // Fire-and-forget sealing against local coverage: UI polls GET until status=ready.
    void downloadSession(db, id).catch((e) => {
      db.prepare("UPDATE sessions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(
        e instanceof Error ? e.message : "Seal failed",
        Math.floor(Date.now() / 1000),
        id,
      );
    });
    return json(sessionDetail(id), 201);
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
  if (sessionMatch) {
    const id = sessionMatch[1]!;
    const rest = sessionMatch[2] ?? "";
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
    if (!existing) return err("Session not found.", 404);

    if ((rest === "" || rest === "/") && method === "GET") return json(sessionDetail(id));
    if ((rest === "" || rest === "/") && method === "PATCH") {
      let body: { name?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return err("Invalid JSON body.");
      }
      if (typeof body.name !== "string" || !body.name.trim()) return err("Name must be a non-empty string.");
      db.prepare("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?").run(
        body.name.trim().slice(0, 80),
        Math.floor(Date.now() / 1000),
        id,
      );
      return json(sessionDetail(id));
    }
    if ((rest === "" || rest === "/") && method === "DELETE") {
      const del = db.transaction(() => {
        db.prepare("DELETE FROM trades WHERE session_id = ?").run(id);
        db.prepare("DELETE FROM orders WHERE session_id = ?").run(id);
        db.prepare("DELETE FROM drawings WHERE session_id = ?").run(id);
        db.prepare("DELETE FROM session_progress WHERE session_id = ?").run(id);
        db.prepare("DELETE FROM session_instruments WHERE session_id = ?").run(id);
        db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      });
      del();
      return json({ ok: true, id });
    }
    if (rest === "/download" && method === "POST") {
      try {
        const summary = await downloadSession(db, id);
        return json(summary);
      } catch (e) {
        return err(e instanceof Error ? e.message : "Seal failed", 502);
      }
    }
    // LOCAL-ONLY candles: served from SQLite, never touches the network.
    if (rest === "/candles" && method === "GET") {
      const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
      const interval = (url.searchParams.get("interval") ?? "").trim();
      if (!isSupportedSymbol(symbol)) return err("Unknown symbol.");
      if (!isSupportedInterval(interval)) return err("Unknown interval. Use one of: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w.");
      // Clamp to the sealed `to` so replay can't leak outside the session
      // range. No lower bound: the client pages left as far as imported
      // history goes (initial load stops at its own context window;
      // scroll-left keeps paging to the oldest bar).
      const inst = db
        .prepare("SELECT from_iso, to_iso FROM session_instruments WHERE session_id = ? AND symbol = ? AND timeframe = ?")
        .get(id, symbol, interval) as { from_iso: string; to_iso: string } | null;
      if (!inst) return err("Instrument is not part of this session.", 404);
      const instToSec = Math.floor(Date.parse(inst.to_iso) / 1000);
      const fromMs = url.searchParams.get("from") ? Date.parse(url.searchParams.get("from")!) : NaN;
      const toMs = url.searchParams.get("to") ? Date.parse(url.searchParams.get("to")!) : NaN;
      const limitRaw = url.searchParams.get("limit");
      // Pass an explicit `from` only when the client asked for one (keeps
      // the ascending window path); otherwise leave it undefined so the
      // backwards-paging path serves the latest bars before the cursor.
      const rangeFrom = Number.isFinite(fromMs) ? Math.floor(fromMs / 1000) : undefined;
      // Default upper bound to the sealed `to` so omitting `?to=` can never
      // leak bars past the session range from the shared candles cache.
      const rangeTo = Number.isFinite(toMs) ? Math.min(Math.floor(toMs / 1000), instToSec) : instToSec;
      const limit = limitRaw ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 1000, 1), 20000) : 5000;
      const { candles } = queryLocalCandles(db, symbol, interval, {
        fromSec: rangeFrom,
        toSec: rangeTo,
        limit,
      });
      return json({ symbol, interval, sessionId: id, candles, feed: "local" });
    }
    // Drawings persistence (per session + symbol).
    if (rest === "/drawings" && method === "GET") {
      const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
      const rows = db
        .prepare("SELECT data FROM drawings WHERE session_id = ? AND symbol = ?")
        .all(id, symbol) as Array<{ data: string }>;
      return json({ drawings: rows.map((r) => JSON.parse(r.data)) });
    }
    if (rest === "/drawings" && method === "PUT") {
      let body: { symbol?: unknown; drawings?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return err("Invalid JSON body.");
      }
      const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
      if (!isSupportedSymbol(symbol)) return err("Unknown symbol.");
      if (!Array.isArray(body.drawings)) return err("drawings must be an array.");
      const now = Math.floor(Date.now() / 1000);
      const save = db.transaction(() => {
        db.prepare("DELETE FROM drawings WHERE session_id = ? AND symbol = ?").run(id, symbol);
        for (const d of body.drawings as Array<{ id?: unknown }>) {
          if (typeof d !== "object" || d === null || typeof d.id !== "string") continue;
          db.prepare("INSERT INTO drawings (id, session_id, symbol, data, updated_at) VALUES (?, ?, ?, ?, ?)").run(
            `${id}:${symbol}:${d.id}`,
            id,
            symbol,
            JSON.stringify(d),
            now,
          );
        }
        db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
      });
      save();
      return json({ ok: true });
    }
    // Replay progress (per session: symbol + timeframe + replay position).
    if (rest === "/progress" && method === "GET") {
      const row = db.prepare("SELECT * FROM session_progress WHERE session_id = ?").get(id) as Record<string, unknown> | null;
      return json({ progress: row ?? null });
    }
    if (rest === "/progress" && method === "PUT") {
      let body: { symbol?: unknown; timeframe?: unknown; replay_cutoff?: unknown; replay_time?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return err("Invalid JSON body.");
      }
      const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
      const timeframe = typeof body.timeframe === "string" ? body.timeframe.trim() : "";
      if (!isSupportedSymbol(symbol)) return err("Unknown symbol.");
      if (!isSupportedInterval(timeframe)) return err("Unknown timeframe.");
      const cutoff = body.replay_cutoff == null ? null : Math.floor(Number(body.replay_cutoff));
      const time = body.replay_time == null ? null : Math.floor(Number(body.replay_time));
      if ((cutoff != null && !Number.isFinite(cutoff)) || (time != null && !Number.isFinite(time))) {
        return err("replay_cutoff and replay_time must be unix timestamps or null.");
      }
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT INTO session_progress (session_id, symbol, timeframe, replay_cutoff, replay_time, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (session_id) DO UPDATE SET symbol = excluded.symbol, timeframe = excluded.timeframe,
            replay_cutoff = excluded.replay_cutoff, replay_time = excluded.replay_time, updated_at = excluded.updated_at`,
      ).run(id, symbol, timeframe, cutoff, time, now);
      return json({ ok: true });
    }
    // Trades persistence (paper-engine close records).
    if (rest === "/trades" && method === "GET") {
      const rows = db.prepare("SELECT * FROM trades WHERE session_id = ? ORDER BY opened_at ASC").all(id);
      return json({ trades: rows });
    }
    if (rest === "/trades" && method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return err("Invalid JSON body.");
      }
      const tradeId = typeof body.id === "string" ? body.id : crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT INTO trades (id, session_id, symbol, side, qty, entry, exit, sl, tp, opened_at, closed_at, pnl, reason,
          order_type, limit_price, stop_price, commission, leverage, parent_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET exit = excluded.exit, closed_at = excluded.closed_at, pnl = excluded.pnl,
           reason = excluded.reason, status = excluded.status, commission = excluded.commission`,
      ).run(
        tradeId,
        id,
        String(body.symbol ?? ""),
        String(body.side ?? ""),
        Number(body.qty ?? 0),
        Number(body.entry ?? 0),
        body.exit == null ? null : Number(body.exit),
        (body.sl as number | undefined) ?? (body.stop as number | undefined) ?? null,
        (body.tp as number | undefined) ?? (body.target as number | undefined) ?? null,
        typeof body.opened_at === "number" ? body.opened_at : now,
        (body.closed_at as number | undefined) ?? null,
        (body.pnl as number | undefined) ?? null,
        (body.reason as string | undefined) ?? null,
        typeof body.order_type === "string" ? body.order_type : "market",
        (body.limit_price as number | undefined) ?? null,
        (body.stop_price as number | undefined) ?? null,
        Number(body.commission ?? 0),
        Number(body.leverage ?? 100),
        (body.parent_id as string | undefined) ?? null,
        typeof body.status === "string" ? body.status : body.exit != null ? "closed" : "open",
      );
      return json({ ok: true, id: tradeId }, 201);
    }
    // Working-order persistence (pending limit/stop/stop-limit).
    if (rest === "/orders" && method === "GET") {
      const status = url.searchParams.get("status") ?? "";
      const rows =
        status && status !== "all"
          ? db.prepare("SELECT * FROM orders WHERE session_id = ? AND status = ? ORDER BY placed_at ASC").all(id, status)
          : db.prepare("SELECT * FROM orders WHERE session_id = ? ORDER BY placed_at ASC").all(id);
      return json({ orders: rows });
    }
    if (rest === "/orders" && method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return err("Invalid JSON body.");
      }
      const orderId = typeof body.id === "string" ? body.id : crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT INTO orders (id, session_id, symbol, side, type, qty, limit_price, stop_price, sl, tp,
          trail_dist, risk_pct, leverage, expiry, status, drawing_id, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET qty = excluded.qty, limit_price = excluded.limit_price,
           stop_price = excluded.stop_price, sl = excluded.sl, tp = excluded.tp,
           trail_dist = excluded.trail_dist, status = excluded.status`,
      ).run(
        orderId,
        id,
        String(body.symbol ?? ""),
        String(body.side ?? ""),
        String(body.type ?? "limit"),
        Number(body.qty ?? 0),
        (body.limit_price as number | undefined) ?? (body.limitPrice as number | undefined) ?? null,
        (body.stop_price as number | undefined) ?? (body.stopPrice as number | undefined) ?? null,
        (body.sl as number | undefined) ?? (body.stop as number | undefined) ?? null,
        (body.tp as number | undefined) ?? (body.target as number | undefined) ?? null,
        (body.trail_dist as number | undefined) ?? (body.trailDist as number | undefined) ?? null,
        (body.risk_pct as number | undefined) ?? (body.riskPct as number | undefined) ?? null,
        Number(body.leverage ?? 100),
        typeof body.expiry === "string" ? body.expiry : "GTC",
        typeof body.status === "string" ? body.status : "pending",
        (body.drawing_id as string | undefined) ?? (body.drawingId as string | undefined) ?? null,
        typeof body.placed_at === "number" ? body.placed_at : now,
      );
      return json({ ok: true, id: orderId }, 201);
    }
    if (rest.startsWith("/orders/") && method === "PATCH") {
      const orderId = rest.slice("/orders/".length);
      if (!orderId) return err("Order id required.", 400);
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return err("Invalid JSON body.");
      }
      const patch: string[] = [];
      const vals: unknown[] = [];
      for (const [col, key] of [
        ["qty", "qty"],
        ["limit_price", "limit_price"],
        ["limit_price", "limitPrice"],
        ["stop_price", "stop_price"],
        ["stop_price", "stopPrice"],
        ["sl", "sl"],
        ["sl", "stop"],
        ["tp", "tp"],
        ["tp", "target"],
        ["trail_dist", "trail_dist"],
        ["trail_dist", "trailDist"],
        ["status", "status"],
      ] as const) {
        if (body[key] !== undefined) {
          patch.push(`${col} = ?`);
          vals.push(body[key] as unknown);
        }
      }
      if (patch.length === 0) return err("Nothing to update.", 400);
      vals.push(orderId, id);
      db.prepare(`UPDATE orders SET ${patch.join(", ")} WHERE id = ? AND session_id = ?`).run(...(vals as []));
      return json({ ok: true, id: orderId });
    }
    if (rest.startsWith("/orders/") && method === "DELETE") {
      const orderId = rest.slice("/orders/".length);
      db.prepare("DELETE FROM orders WHERE id = ? AND session_id = ?").run(orderId, id);
      return json({ ok: true, id: orderId });
    }
    return err("Not found.", 404);
  }

  return err("Not found.", 404);
}

/**
 * Start the TickLab backend (API + static frontend). Electrobun-free — safe
 * to run with plain `bun src/bun/server.ts`. The Cottontail entrypoint
 * (`index.ts`) calls this, then opens the app window.
 */
export function startServer(): { port: number; url: string } {
  Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: handle });
  console.log(`[ticklab] api on http://127.0.0.1:${PORT}`);
  console.log(`[ticklab] web dir: ${WEB_DIR}`);
  return { port: PORT, url: WEB_URL };
}

if (import.meta.main) {
  startServer();
}
