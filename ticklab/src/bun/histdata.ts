import type { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { INTERVAL_SECONDS, SUPPORTED_INTERVALS } from "./download";
import type { Candle } from "./types";

/**
 * HistData.com ASCII M1 importer (manual data path — no network).
 *
 * Row format: `YYYYMMDD HHMMSS;open;high;low;close;tickvol`
 * File wall-times are US Eastern (FX day opens/closes 17:00 ET); they are
 * converted to UTC epoch seconds here. Charts render Europe/London from the
 * epoch (`ChartPanel` UK formatters), so London display needs no extra work.
 *
 * Higher timeframes are resampled from M1 with UTC-epoch buckets
 * (`floor(t/step)*step`, same convention as the chart's `bucketTime`).
 * Daily/weekly bars therefore start at UTC midnight, which is 1h off London
 * midnight in winter — noted, accepted for backtesting.
 *
 * Gap policy: missing minutes stay missing (no synthetic flat bars).
 * DST fall-back duplicates one wall hour per year; both occurrences map to
 * the same epoch and dedupe collapses them (~60 M1 bars lost, negligible).
 */

/** Wall-time zone of HistData.com ASCII files. Overridable per import. */
export const HISTDATA_SOURCE_TZ = "America/New_York";

export interface HistParseStats {
  lines: number;
  skipped: number;
}

/** Parse one `YYYYMMDD HHMMSS;O;H;L;C;V` line. Returns null when malformed. */
export function parseHistLine(
  line: string,
  tzOffsetMsFor: (y: number, mo: number, d: number, h: number, mi: number) => number,
): Candle | null {
  const semi = line.indexOf(";");
  if (semi < 0) return null;
  const stamp = line.slice(0, semi);
  if (stamp.length !== 15 || stamp[8] !== " ") return null;
  const y = +stamp.slice(0, 4);
  const mo = +stamp.slice(4, 6);
  const d = +stamp.slice(6, 8);
  const h = +stamp.slice(9, 11);
  const mi = +stamp.slice(11, 13);
  const s = +stamp.slice(13, 15);
  if (
    !Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) ||
    !Number.isInteger(h) || !Number.isInteger(mi) || !Number.isInteger(s) ||
    mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59
  ) {
    return null;
  }
  const rest = line.slice(semi + 1).split(";");
  if (rest.length < 4) return null;
  const open = Number(rest[0]);
  const high = Number(rest[1]);
  const low = Number(rest[2]);
  const close = Number(rest[3]);
  const volume = rest.length >= 5 ? Number(rest[4]) : 0;
  if (
    !Number.isFinite(open) || !Number.isFinite(high) ||
    !Number.isFinite(low) || !Number.isFinite(close)
  ) {
    return null;
  }
  // Wall time → UTC epoch: epoch = Date.UTC(wall) − offset(wall date).
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const time = Math.floor((wallAsUtc - tzOffsetMsFor(y, mo, d, h, mi)) / 1000);
  if (!Number.isFinite(time) || time <= 0) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
    isOpen: false,
  };
}

const tzFormatterCache = new Map<string, Intl.DateTimeFormat>();

function wallPartsInTz(utcMs: number, tz: string): number {
  let fmt = tzFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    tzFormatterCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/**
 * Resolve the `UTC − wall` offset (ms) for a wall datetime in `tz`.
 * Result is cached per wall day — the offset only changes on DST
 * transitions, so bulk imports pay one `Intl` call per file-day.
 */
export function makeTzOffsetResolver(tz: string): (y: number, mo: number, d: number, h: number, mi: number) => number {
  const cache = new Map<string, number>();
  return (y, mo, d, h, mi) => {
    const key = `${y}-${mo}-${d}`;
    let off = cache.get(key);
    if (off == null) {
      // Probe at local noon (never inside a transition hour).
      let utc = Date.UTC(y, mo - 1, d, 12, 0, 0);
      for (let i = 0; i < 3; i++) {
        const wallMs = wallPartsInTz(utc, tz);
        utc = Date.UTC(y, mo - 1, d, 12, 0, 0) - (wallMs - utc);
      }
      off = wallPartsInTz(utc, tz) - utc;
      cache.set(key, off);
    }
    // Minute-level DST transitions don't exist in practice; day offset is exact.
    void h;
    void mi;
    return off;
  };
}

/** Parse full M1 CSV text into ascending, de-duplicated candles. */
export function parseHistDataM1(text: string, sourceTz = HISTDATA_SOURCE_TZ): { candles: Candle[]; stats: HistParseStats } {
  const resolve = makeTzOffsetResolver(sourceTz);
  const seen = new Set<number>();
  const out: Candle[] = [];
  let lines = 0;
  let skipped = 0;
  let start = 0;
  const pushLine = (line: string): void => {
    if (!line) return;
    lines++;
    const c = parseHistLine(line, resolve);
    if (!c || seen.has(c.time)) {
      skipped++;
      return;
    }
    seen.add(c.time);
    out.push(c);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      let line = text.slice(start, i);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      pushLine(line.trim());
      start = i + 1;
    }
  }
  if (start < text.length) pushLine(text.slice(start).trim());
  out.sort((a, b) => a.time - b.time);
  return { candles: out, stats: { lines, skipped } };
}

/**
 * Resample ascending M1 candles into a higher timeframe. Buckets are UTC
 * epoch aligned. Input may span file boundaries — the caller carries the
 * trailing partial bucket across chunks via `carry`.
 */
export function resampleCandles(m1: Candle[], interval: string, carry?: Candle | null): { candles: Candle[]; carry: Candle | null } {
  const step = INTERVAL_SECONDS[interval];
  if (!step || interval === "1m") {
    return { candles: interval === "1m" ? m1 : [], carry: null };
  }
  const out: Candle[] = [];
  let cur: Candle | null = carry ?? null;
  for (const b of m1) {
    const bucket = Math.floor(b.time / step) * step;
    if (cur && cur.time === bucket) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    } else {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, isOpen: false };
    }
  }
  return { candles: out, carry: cur };
}

/** Chunked idempotent upsert (re-imports of overlapping files are safe). */
export function upsertCandles(db: Database, symbol: string, interval: string, candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT INTO candles (symbol, interval, time, open, high, low, close, volume, is_open)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol, interval, time) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume, is_open = excluded.is_open
  `);
  const txn = db.transaction((rows: Candle[]) => {
    for (const c of rows) {
      stmt.run(symbol, interval, c.time, c.open, c.high, c.low, c.close, c.volume ?? 0, c.isOpen ? 1 : 0);
    }
  });
  const CHUNK = 20000;
  for (let i = 0; i < candles.length; i += CHUNK) {
    txn(candles.slice(i, i + CHUNK));
  }
  return candles.length;
}

/** `EUR-USD` / `eur_usd` / `EURUSD` → `EURUSD`. */
export function normalizeSymbol(v: string): string {
  return v.toUpperCase().replace(/[^A-Z]/g, "");
}

export interface FileImportSummary {
  files: number;
  m1Bars: number;
  skipped: number;
  perInterval: Record<string, number>;
  from: number | null;
  to: number | null;
}

export interface HistImportOptions {
  sourceTz?: string;
}

/**
 * Shared streaming import core — the single code path behind both the CLI
 * bulk importer and the GUI job upload. Text chunks (disk files or uploaded
 * files) are fed in sorted order via `appendText`; higher-timeframe resample
 * `carry` is held across chunks so boundary bars are identical no matter
 * the source. Previously the GUI path (`importHistDataText`) reset carry per
 * upload and produced wrong 5m…1w boundary bars on multi-file imports.
 */
export interface HistImportSession {
  appendText(text: string): void;
  finish(): FileImportSummary;
  progress(): { files: number; m1Bars: number; skipped: number };
}

export function createHistImport(db: Database, symbol: string, opts?: HistImportOptions): HistImportSession {
  const sym = normalizeSymbol(symbol);
  const tz = opts?.sourceTz ?? HISTDATA_SOURCE_TZ;
  const resolve = makeTzOffsetResolver(tz);
  const carry = new Map<string, Candle | null>();
  const totals = new Map<string, number>();
  for (const interval of SUPPORTED_INTERVALS) {
    if (interval !== "1m") {
      carry.set(interval, null);
      totals.set(interval, 0);
    }
  }
  let m1Bars = 0;
  let skipped = 0;
  let files = 0;
  let from: number | null = null;
  let to: number | null = null;

  const batch: Candle[] = [];
  const seenFile = new Set<number>();
  const flushBatch = (): void => {
    if (batch.length === 0) return;
    batch.sort((a, b) => a.time - b.time);
    m1Bars += upsertCandles(db, sym, "1m", batch);
    if (batch[0]!.time < (from ?? Infinity)) from = batch[0]!.time;
    if (batch[batch.length - 1]!.time > (to ?? -Infinity)) to = batch[batch.length - 1]!.time;
    for (const interval of SUPPORTED_INTERVALS) {
      if (interval === "1m") continue;
      const r = resampleCandles(batch, interval, carry.get(interval) ?? null);
      if (r.candles.length > 0) {
        totals.set(interval, (totals.get(interval) ?? 0) + upsertCandles(db, sym, interval, r.candles));
      }
      carry.set(interval, r.carry);
    }
    batch.length = 0;
    seenFile.clear();
  };

  return {
    appendText(text: string): void {
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") {
          let line = text.slice(start, i);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          line = line.trim();
          if (line) {
            const c = parseHistLine(line, resolve);
            if (!c || seenFile.has(c.time)) skipped++;
            else {
              seenFile.add(c.time);
              batch.push(c);
              if (batch.length >= 50000) flushBatch();
            }
          }
          start = i + 1;
        }
      }
      if (start < text.length) {
        const line = text.slice(start).trim();
        if (line) {
          const c = parseHistLine(line, resolve);
          if (!c || seenFile.has(c.time)) skipped++;
          else {
            seenFile.add(c.time);
            batch.push(c);
          }
        }
      }
      flushBatch();
      files++;
    },
    finish(): FileImportSummary {
      for (const interval of SUPPORTED_INTERVALS) {
        if (interval === "1m") continue;
        const tail = carry.get(interval);
        if (tail) totals.set(interval, (totals.get(interval) ?? 0) + upsertCandles(db, sym, interval, [tail]));
      }
      const perInterval: Record<string, number> = { "1m": m1Bars };
      for (const [k, v] of totals) perInterval[k] = v;
      return { files, m1Bars, skipped, perInterval, from, to };
    },
    progress(): { files: number; m1Bars: number; skipped: number } {
      return { files, m1Bars, skipped };
    },
  };
}

function listCsvFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const abs = join(d, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.csv$/i.test(entry)) out.push(abs);
    }
  };
  walk(dir);
  out.sort();
  return out;
}

/**
 * Bulk import: every `*.csv` under `dir` (recursive) as M1 for `symbol`.
 * Thin wrapper over the shared streaming core (`createHistImport`) — the
 * same processing the GUI job upload uses. Memory-safe — files stream
 * through the DB in chunks with cross-file resample carry.
 */
export async function importHistDataDir(
  db: Database,
  dir: string,
  symbol: string,
  opts?: { sourceTz?: string; onProgress?: (msg: string) => void },
): Promise<FileImportSummary> {
  const say = opts?.onProgress ?? ((): void => {});
  const files = listCsvFiles(dir);
  if (files.length === 0) throw new Error(`No CSV files found under ${dir}`);
  const session = createHistImport(db, symbol, { sourceTz: opts?.sourceTz });
  for (const file of files) {
    const text = await Bun.file(file).text();
    session.appendText(text);
    say(`${file}: done`);
  }
  return session.finish();
}

/**
 * Import one or more uploaded CSV texts for `symbol` through the shared
 * streaming core — identical processing to the CLI bulk importer, including
 * cross-file higher-timeframe resample carry. Texts must be passed in
 * filename-sorted order (the GUI sorts before upload, mirroring the CLI's
 * `listCsvFiles` sort). No size cap: callers stream one file at a time.
 */
export function importHistDataTexts(
  db: Database,
  symbol: string,
  texts: string[],
  opts?: { sourceTz?: string },
): FileImportSummary {
  const session = createHistImport(db, symbol, { sourceTz: opts?.sourceTz });
  for (const text of texts) session.appendText(text);
  return session.finish();
}

/** Single-text import for the UI upload path (no size cap — desktop app). */
export function importHistDataText(
  db: Database,
  symbol: string,
  text: string,
  opts?: { sourceTz?: string; baseInterval?: string },
): FileImportSummary {
  const base = opts?.baseInterval ?? "1m";
  if (base !== "1m") {
    const sym = normalizeSymbol(symbol);
    const { candles, stats } = parseHistDataM1(text, opts?.sourceTz ?? HISTDATA_SOURCE_TZ);
    const perInterval: Record<string, number> = {};
    perInterval[base] = upsertCandles(db, sym, base, candles);
    return {
      files: 1,
      m1Bars: candles.length,
      skipped: stats.skipped,
      perInterval,
      from: candles.length > 0 ? candles[0]!.time : null,
      to: candles.length > 0 ? candles[candles.length - 1]!.time : null,
    };
  }
  return importHistDataTexts(db, symbol, [text], { sourceTz: opts?.sourceTz });
}
