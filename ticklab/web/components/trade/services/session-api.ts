/**
 * TickLab local API client. The Bun backend (`src/bun`) serves sessions and
 * imported candle bundles on 127.0.0.1 — backtesting is fully offline.
 */
import type { Symbol, Timeframe } from "../constants";
import type { Candle } from "./types";

function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || "http://127.0.0.1:4578";
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Cannot reach the TickLab backend. Is it running?");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Request failed.";
    throw new Error(msg);
  }
  return body as T;
}

export interface SessionInstrument {
  symbol: Symbol;
  interval: Timeframe;
  from: string;
  to: string;
  cached_bars: number;
  status: string;
  error: string | null;
}

export interface BacktestSession {
  id: string;
  name: string;
  status: "draft" | "downloading" | "ready" | "partial" | "failed";
  error: string | null;
  created_at: number;
  updated_at: number;
  instruments: SessionInstrument[];
}

export async function listSessions(): Promise<BacktestSession[]> {
  const body = await req<{ sessions: BacktestSession[] }>("/api/sessions");
  return body.sessions;
}

export async function createSession(input: {
  name: string;
  symbols: Symbol[];
  timeframes: Timeframe[];
  from: string;
  to: string;
}): Promise<BacktestSession> {
  return req<BacktestSession>("/api/sessions", { method: "POST", body: JSON.stringify(input) });
}

export async function getSession(id: string): Promise<BacktestSession> {
  return req<BacktestSession>(`/api/sessions/${id}`);
}

export async function renameSession(id: string, name: string): Promise<BacktestSession> {
  return req<BacktestSession>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function deleteSession(id: string): Promise<void> {
  await req(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function retryDownload(id: string): Promise<{ status: string }> {
  return req(`/api/sessions/${id}/download`, { method: "POST" });
}

export interface Coverage {
  symbol: string;
  interval: string;
  bars: number;
  from: number | null;
  to: number | null;
}

/** Locally imported data per symbol × interval (drives the coverage table). */
export async function getCoverage(): Promise<Coverage[]> {
  const body = await req<{ coverage?: unknown }>("/api/coverage");
  if (!Array.isArray(body.coverage)) throw new Error("Backend returned invalid data.");
  return body.coverage as Coverage[];
}

export interface ImportSummary {
  symbol: string;
  files: number;
  m1Bars: number;
  skipped: number;
  perInterval: Record<string, number>;
  from: number | null;
  to: number | null;
}

/**
 * Upload HistData.com M1 CSVs for manual imports (any size — desktop app).
 * Single-file top-ups post directly to POST /api/import; multi-file bulk
 * imports run as a job (start → one chunk POST per file in filename-sorted
 * order → finish) so the backend shares cross-file resample carry, exactly
 * like the CLI bulk importer.
 * Note: plain FormData posts (no JSON content-type) — separate fetch path.
 */
export async function uploadImportCsv(symbol: Symbol, file: File): Promise<ImportSummary> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "") || "http://127.0.0.1:4578";
  const form = new FormData();
  form.set("symbol", symbol);
  form.set("file", file);
  let res: Response;
  try {
    res = await fetch(`${base}/api/import`, { method: "POST", body: form });
  } catch {
    throw new Error("Cannot reach the TickLab backend. Is it running?");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Import failed.";
    throw new Error(msg);
  }
  return body as ImportSummary;
}

export interface ImportJobProgress {
  jobId: string;
  symbol: string;
  done: number;
  total: number;
  m1Bars: number;
  skipped: number;
}

/** Start a multi-file bulk import job. `fileNames` in upload order. */
export async function startImportJob(symbol: Symbol, fileNames: string[]): Promise<{ jobId: string; symbol: string; total: number }> {
  return req("/api/import/start", { method: "POST", body: JSON.stringify({ symbol, fileNames }) });
}

/** Upload one CSV of a running job (sequential, in start order). */
export async function uploadImportChunk(jobId: string, index: number, file: File): Promise<ImportJobProgress> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "") || "http://127.0.0.1:4578";
  const form = new FormData();
  form.set("jobId", jobId);
  form.set("index", String(index));
  form.set("file", file);
  let res: Response;
  try {
    res = await fetch(`${base}/api/import/chunk`, { method: "POST", body: form });
  } catch {
    throw new Error("Cannot reach the TickLab backend. Is it running?");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Import failed.";
    throw new Error(msg);
  }
  return body as ImportJobProgress;
}

/** Finish a bulk import job and return the final summary. */
export async function finishImportJob(jobId: string): Promise<ImportSummary & { jobId: string }> {
  return req("/api/import/finish", { method: "POST", body: JSON.stringify({ jobId }) });
}

/** Cancel a running bulk import job. */
export async function cancelImportJob(jobId: string): Promise<void> {
  await req(`/api/import/${jobId}`, { method: "DELETE" });
}

/**
 * Sealed candles for one session instrument. Strictly local — the server
 * answers from SQLite and clamps to the session range.
 */export async function fetchSessionCandles(
  sessionId: string,
  symbol: Symbol,
  interval: Timeframe,
  range?: { from?: string; to?: string; limit?: number },
): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol, interval });
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  if (range?.limit) params.set("limit", String(range.limit));
  const body = await req<{ candles?: unknown }>(`/api/sessions/${sessionId}/candles?${params.toString()}`);
  if (!Array.isArray(body.candles)) throw new Error("Backend returned invalid data.");
  return body.candles as Candle[];
}

// ── Replay progress persistence (per-session symbol + timeframe + replay position) ──

export interface SessionProgress {
  session_id: string;
  symbol: Symbol;
  timeframe: Timeframe;
  replay_cutoff: number | null;
  replay_time: number | null;
  updated_at: number;
}

export async function fetchSessionProgress(sessionId: string): Promise<SessionProgress | null> {
  try {
    const body = await req<{ progress?: unknown }>(`/api/sessions/${sessionId}/progress`);
    const p = body.progress;
    if (typeof p !== "object" || p === null) return null;
    return p as SessionProgress;
  } catch {
    return null;
  }
}

export async function saveSessionProgress(
  sessionId: string,
  progress: { symbol: Symbol; timeframe: Timeframe; replay_cutoff: number | null; replay_time: number | null },
): Promise<void> {
  try {
    await req(`/api/sessions/${sessionId}/progress`, { method: "PUT", body: JSON.stringify(progress) });
  } catch {
    // Local-first: persistence is best-effort, in-memory replay state stays canonical.
  }
}

// ── Trading persistence (per-session paper trades + working orders) ──

export interface PersistedTrade {
  id: string;
  session_id: string;
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  exit: number | null;
  sl: number | null;
  tp: number | null;
  opened_at: number;
  closed_at: number | null;
  pnl: number | null;
  reason: string | null;
  order_type?: string;
  limit_price?: number | null;
  stop_price?: number | null;
  commission?: number;
  leverage?: number;
  parent_id?: string | null;
  status?: string;
}

export async function fetchSessionTrades(sessionId: string): Promise<PersistedTrade[]> {
  try {
    const body = await req<{ trades?: unknown }>(`/api/sessions/${sessionId}/trades`);
    if (!Array.isArray(body.trades)) return [];
    return body.trades as PersistedTrade[];
  } catch {
    return [];
  }
}

export async function persistTrade(sessionId: string, trade: Record<string, unknown>): Promise<void> {
  try {
    await req(`/api/sessions/${sessionId}/trades`, { method: "POST", body: JSON.stringify(trade) });
  } catch {
    // Local-first: persistence is best-effort, engine state stays canonical.
  }
}

export interface PersistedOrder {
  id: string;
  session_id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  limit_price: number | null;
  stop_price: number | null;
  sl: number | null;
  tp: number | null;
  trail_dist: number | null;
  risk_pct: number | null;
  leverage: number;
  expiry: string;
  status: string;
  drawing_id: string | null;
  placed_at: number;
}

export async function fetchSessionOrders(sessionId: string, status = "all"): Promise<PersistedOrder[]> {
  try {
    const body = await req<{ orders?: unknown }>(
      `/api/sessions/${sessionId}/orders?status=${encodeURIComponent(status)}`,
    );
    if (!Array.isArray(body.orders)) return [];
    return body.orders as PersistedOrder[];
  } catch {
    return [];
  }
}

export async function persistOrder(sessionId: string, order: Record<string, unknown>): Promise<void> {
  try {
    await req(`/api/sessions/${sessionId}/orders`, { method: "POST", body: JSON.stringify(order) });
  } catch {
    // Best-effort (see persistTrade).
  }
}

export async function patchSessionOrder(sessionId: string, orderId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await req(`/api/sessions/${sessionId}/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(patch) });
  } catch {
    // Best-effort.
  }
}

export async function deleteSessionOrder(sessionId: string, orderId: string): Promise<void> {
  try {
    await req(`/api/sessions/${sessionId}/orders/${orderId}`, { method: "DELETE" });
  } catch {
    // Best-effort.
  }
}
