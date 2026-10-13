/** Shared candle shapes for imported price data (see histdata.ts). */

/** Upstream fetch timeout (each feed gets this long before fallback/502). */
export const FEED_TIMEOUT_MS = 8000;

export interface Candle {
  /** Unix seconds, ascending. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True for the still-forming bar. */
  isOpen: boolean;
}

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  price: number | null;
  /** Unix seconds. */
  time: number;
  marketState: string | null;
}
