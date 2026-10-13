import type { Database } from "bun:sqlite";

/**
 * Local-only candle reads for backtesting. This module must NEVER import
 * `./download` (sealer) and must NEVER call fetch() — backtesting is
 * only possible from data already imported into SQLite.
 */

export interface LocalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isOpen: boolean;
}

export function queryLocalCandles(
  db: Database,
  symbol: string,
  interval: string,
  opts: { fromSec?: number; toSec?: number; limit?: number },
): { candles: LocalCandle[]; from: number | null; to: number | null } {
  const { fromSec, toSec, limit = 5000 } = opts;
  const clamped = Math.min(Math.max(Math.floor(limit), 1), 20000);

  let rows: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    is_open: number;
  }>;
  if (fromSec != null && toSec != null) {
    // Explicit window fetch: ascending. Callers clamp `toSec` to the sealed
    // session end; there is no lower bound besides imported history.
    rows = db
      .prepare(
        `SELECT time, open, high, low, close, volume, is_open FROM candles
         WHERE symbol = ? AND interval = ? AND time >= ? AND time <= ?
         ORDER BY time ASC LIMIT ?`,
      )
      .all(symbol, interval, fromSec, toSec, clamped) as typeof rows;
  } else {
    // Backwards paging: latest bars at/before the cursor (never past the
    // sealed `to` — callers default the cursor to it), back to the oldest
    // imported bar.
    const bound = toSec ?? 9999999999;
    rows = db
      .prepare(
        `SELECT time, open, high, low, close, volume, is_open FROM candles
         WHERE symbol = ? AND interval = ? AND time <= ?
         ORDER BY time DESC LIMIT ?`,
      )
      .all(symbol, interval, bound, clamped) as typeof rows;
    rows.reverse();
  }

  const candles = rows.map((r) => ({
    time: r.time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    isOpen: r.is_open === 1,
  }));
  return {
    candles,
    from: candles.length > 0 ? candles[0]!.time : null,
    to: candles.length > 0 ? candles[candles.length - 1]!.time : null,
  };
}
