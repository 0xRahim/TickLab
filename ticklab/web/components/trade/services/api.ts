/**
 * REST-shaped facade. UI code talks only to this module (and ws.ts) —
 * never to feed internals directly — so a backend swap touches just
 * these two files. All market data is live from the Tradeye price API.
 */
import { SYMBOLS, type Symbol, type Timeframe } from "../constants";
import type { DrawingLine } from "../drawings/constants";
import { fetchCandles } from "./market-api";
import { drawingsStore } from "./drawings-store";
import type { Candle } from "./types";

export interface SymbolInfo {
  symbol: Symbol;
}

export interface CandleResult {
  candles: Candle[];
  /** Always true — every bar comes from real history. */
  real: boolean;
}

export const api = {
  getSymbols(): SymbolInfo[] {
    return SYMBOLS.map((symbol) => ({ symbol }));
  },

  async getCandles(symbol: Symbol, timeframe: Timeframe): Promise<CandleResult> {
    const candles = await fetchCandles(symbol, timeframe);
    return { candles, real: true };
  },

  /** Older live chunk for scroll-left backfill. */
  getOlderCandles(
    symbol: Symbol,
    timeframe: Timeframe,
    range: { from: string; to: string },
  ): Promise<Candle[]> {
    return fetchCandles(symbol, timeframe, range);
  },

  chartDrawings: {
    list(symbol: Symbol): Promise<DrawingLine[]> {
      return drawingsStore.list(symbol);
    },
    save(symbol: Symbol, drawing: DrawingLine): Promise<void> {
      return drawingsStore.save(symbol, drawing);
    },
    remove(symbol: Symbol, id: string): Promise<void> {
      return drawingsStore.remove(symbol, id);
    },
    clear(symbol: Symbol): Promise<void> {
      return drawingsStore.clear(symbol);
    },
  },
};
