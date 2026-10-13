/** Shared market-data shapes. UI code depends only on these + api.ts/ws.ts. */

export interface Candle {
  /** Unix seconds, ascending, de-duplicated. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTick {
  symbol: string;
  /** Mid price derived from the replayed close. */
  price: number;
  /** Unix seconds. */
  time: number;
}

export type TickHandler = (tick: MarketTick) => void;
