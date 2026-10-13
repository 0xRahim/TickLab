/**
 * Pure tick-to-bar builder. Folds a price tick into an ascending candle
 * array: mutates the forming bar while the tick stays in its timeframe
 * bucket, appends a fresh bar (`open = prev close`) once the bucket rolls
 * over. No React, no chart calls — the caller pushes the returned tail bar
 * via `series.update()`.
 */
import type { Candle } from "../services/types";

/** Safety cap for tick-extended arrays (trimmed oldest-first). */
export const MAX_TICK_BARS = 5000;

/** Floor an epoch-second timestamp to its timeframe bucket. */
export function bucketTime(epochSec: number, intervalSec: number): number {
  return Math.floor(epochSec / intervalSec) * intervalSec;
}

/**
 * Merge an older chunk in front of the loaded series: union by `time`,
 * ascending. Returns the existing array untouched when nothing is new.
 */
export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  if (incoming.length === 0) return existing;
  const seen = new Set<number>();
  for (const b of existing) seen.add(b.time);
  let added = false;
  const out = [...existing];
  for (const b of incoming) {
    if (seen.has(b.time)) continue;
    seen.add(b.time);
    out.push(b);
    added = true;
  }
  if (!added) return existing;
  out.sort((a, b) => a.time - b.time);
  return out;
}

export interface TickApplied {
  /** Tail bar to render (mutated forming bar or freshly appended bar). */
  bar: Candle;
  /** True when a new candle was printed. */
  isNewBar: boolean;
}

/**
 * Apply `price` observed at `epochSec` to `bars` (mutated in place).
 * Returns null when there is nothing to update (no bars, bad input).
 */
export function applyTick(
  bars: Candle[],
  price: number,
  epochSec: number,
  intervalSec: number,
): TickApplied | null {
  if (!Number.isFinite(price) || !Number.isFinite(epochSec) || intervalSec <= 0) {
    return null;
  }
  const last = bars.at(-1);
  if (!last) return null;

  if (bucketTime(Math.floor(epochSec), intervalSec) > last.time) {
    const bar: Candle = {
      time: bucketTime(Math.floor(epochSec), intervalSec),
      open: last.close,
      high: price,
      low: price,
      close: price,
      volume: 0,
    };
    bars.push(bar);
    if (bars.length > MAX_TICK_BARS) bars.splice(0, bars.length - MAX_TICK_BARS);
    return { bar, isNewBar: true };
  }

  // Same bucket (or skewed clock) — keep mutating the forming bar.
  const bar: Candle = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  bars[bars.length - 1] = bar;
  return { bar, isNewBar: false };
}
