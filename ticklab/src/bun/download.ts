import type { Database } from "bun:sqlite";

/**
 * Session sealer — local-only. TickLab works purely from manually imported
 * candle data (see `histdata.ts` + `import-histdata.ts`); there is no network
 * price feed. Sealing a session means verifying SQLite covers the session
 * range (plus replay context) for every instrument.
 *
 * Never import a network module here and never call fetch() — backtesting
 * reads only what was imported.
 */

export const SUPPORTED_SYMBOLS = ["BTCUSD", "EURUSD", "GBPUSD", "XAUUSD", "USDCAD"] as const;
export const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;

export type Interval = (typeof SUPPORTED_INTERVALS)[number];

export const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Historic context bars sealed left of a session's `from` so the chart can
 * form context before the replay start. `from_iso` stays the playable
 * replay start. */
export const SESSION_CONTEXT_BARS = 1000;

export function isSupportedSymbol(v: unknown): v is string {
  return typeof v === "string" && (SUPPORTED_SYMBOLS as readonly string[]).includes(v.toUpperCase());
}

export function isSupportedInterval(v: unknown): v is Interval {
  return typeof v === "string" && (SUPPORTED_INTERVALS as readonly string[]).includes(v);
}

export interface Coverage {
  symbol: string;
  interval: string;
  bars: number;
  from: number | null;
  to: number | null;
}

/** Local data coverage for one (symbol, interval) across the whole cache. */
export function getCoverage(db: Database, symbol: string, interval: string): Coverage {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS bars, MIN(time) AS from_time, MAX(time) AS to_time
       FROM candles WHERE symbol = ? AND interval = ?`,
    )
    .get(symbol, interval) as { bars: number; from_time: number | null; to_time: number | null };
  return {
    symbol,
    interval,
    bars: row.bars ?? 0,
    from: row.from_time,
    to: row.to_time,
  };
}

/** Coverage for every supported symbol × interval that has any local data. */
export function getAllCoverage(db: Database): Coverage[] {
  const rows = db
    .prepare(
      `SELECT symbol, interval, COUNT(*) AS bars, MIN(time) AS from_time, MAX(time) AS to_time
       FROM candles GROUP BY symbol, interval ORDER BY symbol, interval`,
    )
    .all() as Array<{ symbol: string; interval: string; bars: number; from_time: number | null; to_time: number | null }>;
  return rows.map((r) => ({
    symbol: r.symbol,
    interval: r.interval,
    bars: r.bars ?? 0,
    from: r.from_time,
    to: r.to_time,
  }));
}

export interface DownloadSummary {
  sessionId: string;
  status: "ready" | "partial" | "failed";
  instruments: Array<{ symbol: string; timeframe: string; cached_bars: number; status: string; error: string | null }>;
}

function noDataError(symbol: string, timeframe: string): string {
  return (
    `No local data for ${symbol} ${timeframe} in this range. ` +
    `Import price data first from the Candlestick data page (HistData.com M1 CSVs, any size) ` +
    `or via \`bun src/bun/import-histdata.ts --symbol ${symbol} <csv-dir>\`.`
  );
}

/** Seal a session against local coverage: every instrument whose cached
 * range spans [contextFrom, to] completes; the rest fail with an import
 * hint. `from_iso` stays the playable replay start. */
export async function downloadSession(db: Database, sessionId: string): Promise<DownloadSummary> {
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE sessions SET status = 'downloading', error = NULL, updated_at = ? WHERE id = ?").run(now, sessionId);
  const rows = db
    .prepare("SELECT * FROM session_instruments WHERE session_id = ?")
    .all(sessionId) as Array<{
    symbol: string;
    timeframe: string;
    from_iso: string;
    to_iso: string;
  }>;

  const summary: DownloadSummary["instruments"] = [];
  for (const r of rows) {
    db.prepare("UPDATE session_instruments SET status = 'downloading', error = NULL WHERE session_id = ? AND symbol = ? AND timeframe = ?").run(
      sessionId,
      r.symbol,
      r.timeframe,
    );
    const stepSec = INTERVAL_SECONDS[r.timeframe] ?? 3600;
    const fromSec = Math.floor(Date.parse(r.from_iso) / 1000);
    const toSec = Math.floor(Date.parse(r.to_iso) / 1000);
    const contextFrom = fromSec - SESSION_CONTEXT_BARS * stepSec;
    const cov = db
      .prepare(
        `SELECT COUNT(*) AS bars, MIN(time) AS from_time, MAX(time) AS to_time
         FROM candles WHERE symbol = ? AND interval = ? AND time >= ? AND time <= ?`,
      )
      .get(r.symbol, r.timeframe, contextFrom, toSec) as {
      bars: number;
      from_time: number | null;
      to_time: number | null;
    };
    const bars = cov.bars ?? 0;
    // Trailing tolerance: `to` often lands on a weekend/holiday (or "now"
    // while the latest import is days old). Seal when data ends within two
    // bars or 4 days of the range end, whichever is larger.
    const trailingTol = Math.max(2 * stepSec, 4 * 86400);
    const covered =
      bars > 0 && cov.from_time != null && cov.to_time != null &&
      cov.from_time <= fromSec && cov.to_time + trailingTol >= toSec - stepSec;
    if (covered) {
      db.prepare("UPDATE session_instruments SET cached_bars = ?, status = 'complete' WHERE session_id = ? AND symbol = ? AND timeframe = ?").run(
        bars,
        sessionId,
        r.symbol,
        r.timeframe,
      );
      summary.push({ symbol: r.symbol, timeframe: r.timeframe, cached_bars: bars, status: "complete", error: null });
    } else {
      const message = noDataError(r.symbol, r.timeframe);
      db.prepare("UPDATE session_instruments SET cached_bars = ?, status = 'failed', error = ? WHERE session_id = ? AND symbol = ? AND timeframe = ?").run(
        bars,
        message,
        sessionId,
        r.symbol,
        r.timeframe,
      );
      summary.push({ symbol: r.symbol, timeframe: r.timeframe, cached_bars: bars, status: "failed", error: message });
    }
  }

  const failed = summary.filter((s) => s.status === "failed").length;
  const status = failed === 0 ? "ready" : failed === summary.length ? "failed" : "partial";
  db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Math.floor(Date.now() / 1000), sessionId);
  return { sessionId, status, instruments: summary };
}
