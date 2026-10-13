/** Deterministic sample OHLC data for the landing-page replay animation.
 * Seeded PRNG → identical output on server and client (no hydration mismatch).
 * ~260 hourly bars with realistic regimes: range → markup → pullback → markdown → base.
 */

export interface SampleCandle {
  time: number; // UTC epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Regime drifts per bar (fractional) + volatility per regime.
const REGIMES: Array<{ bars: number; drift: number; vol: number }> = [
  { bars: 52, drift: 0.0002, vol: 0.0016 }, // quiet range
  { bars: 48, drift: 0.0011, vol: 0.0022 }, // markup
  { bars: 36, drift: -0.0006, vol: 0.0026 }, // pullback (bearish sequence)
  { bars: 52, drift: -0.001, vol: 0.0024 }, // markdown
  { bars: 40, drift: 0.0009, vol: 0.002 }, // recovery
  { bars: 32, drift: 0.0001, vol: 0.0014 }, // compression
];

const START_TIME = Date.UTC(2024, 9, 7, 8, 0, 0) / 1000; // fixed anchor
const HOUR = 3600;
const START_PRICE = 1.096;

export function buildSampleCandles(): SampleCandle[] {
  const rand = mulberry32(0x71c1ab);
  const out: SampleCandle[] = [];
  let price = START_PRICE;
  let t = START_TIME;

  for (const regime of REGIMES) {
    for (let i = 0; i < regime.bars; i++) {
      const open = price;
      // Intrabar path: drift + noise, with occasional wick extension.
      const drift = regime.drift + (rand() - 0.5) * regime.vol * 2;
      const close = Math.max(0.5, open * (1 + drift));
      const spread = Math.abs(close - open);
      const wickUp = spread * (0.4 + rand() * 1.4) + open * regime.vol * 0.35 * rand();
      const wickDown = spread * (0.4 + rand() * 1.4) + open * regime.vol * 0.35 * rand();
      const high = Math.max(open, close) + wickUp;
      const low = Math.max(0.5, Math.min(open, close) - wickDown);
      out.push({ time: t, open, high, low, close });
      price = close;
      t += HOUR;
    }
  }
  return out;
}

/** Module-level memo so every import shares one stable array. */
let cache: SampleCandle[] | null = null;
export function getSampleCandles(): SampleCandle[] {
  if (!cache) cache = buildSampleCandles();
  return cache;
}

export function formatSamplePrice(n: number, digits = 5): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSampleTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
