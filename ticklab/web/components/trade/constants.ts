// Instrument + timeframe constants. Symbols are the tickers served by the
// Tradeye price API (/api/symbols); the dropdown refreshes from there with
// this list as fallback.

export const SYMBOLS = ["BTCUSD", "EURUSD", "GBPUSD", "XAUUSD", "USDCAD"] as const;

export type Symbol = (typeof SYMBOLS)[number];

export const TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

/** Seconds per timeframe bar. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Minimum visible decimals per symbol (broker-style floor).
 * JSON/SQLite numbers strip trailing zeros (1.14400 -> 1.144), so detection
 * alone would undercount — the floor preserves them. */
export const SYMBOL_MIN_DIGITS: Record<Symbol, number> = {
  BTCUSD: 2,
  EURUSD: 5,
  GBPUSD: 5,
  XAUUSD: 2,
  USDCAD: 5,
};

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(Math.abs(n));
  // Handle scientific notation (e.g. 1e-7) defensively.
  if (s.includes("e") || s.includes("E")) {
    try {
      return Math.min(8, n.toFixed(8).split(".")[1]?.replace(/0+$/, "").length ?? 0);
    } catch {
      return 0;
    }
  }
  const dot = s.indexOf(".");
  if (dot === -1) return 0;
  // Cap at 8 to ignore float noise; length includes trailing zeros only if
  // they survived serialization (hence the symbol floor above).
  return Math.min(8, s.length - dot - 1);
}

/**
 * Full-precision digits for a symbol: max(symbol floor, observed decimals
 * in the loaded candles). Scans the tail for speed; OHLC all count so a
 * wick high/low with extra precision is not missed.
 */
export function getPriceDigits(
  symbol: string,
  candles: Array<{ open?: number; high?: number; low?: number; close: number }>,
): number {
  const floor =
    (SYMBOL_MIN_DIGITS as Record<string, number>)[symbol] ?? 2;
  if (candles.length === 0) return floor;
  let observed = 0;
  const start = Math.max(0, candles.length - 200);
  for (let i = start; i < candles.length; i++) {
    const b = candles[i]!;
    observed = Math.max(observed, decimalsOf(b.close));
    if (typeof b.open === "number") observed = Math.max(observed, decimalsOf(b.open));
    if (typeof b.high === "number") observed = Math.max(observed, decimalsOf(b.high));
    if (typeof b.low === "number") observed = Math.max(observed, decimalsOf(b.low));
    if (observed >= 8) break;
  }
  return Math.max(floor, Math.min(8, observed));
}

/** Format a price with exactly `digits` decimals + thousands separators. */
export function formatPrice(n: number, digits: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
