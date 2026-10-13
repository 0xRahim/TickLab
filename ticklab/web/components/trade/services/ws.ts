/**
 * Streaming facade. Polls the Tradeye price API for latest quotes;
 * ticks are skipped while bar replay is paused.
 */
import type { Symbol } from "../constants";
import type { TickHandler } from "./types";
import { fetchQuote } from "./market-api";

const LIVE_POLL_MS = 3000;

let feedPaused = false;

/** Pause tick delivery (bar replay sets this; always resumed after). */
export function setFeedPaused(p: boolean): void {
  feedPaused = p;
}

export function isFeedPaused(): boolean {
  return feedPaused;
}

export const ws = {
  subscribe(symbol: Symbol, handler: TickHandler): () => void {
    let stopped = false;
    const poll = async (): Promise<void> => {
      if (stopped || feedPaused) return;
      try {
        const quote = await fetchQuote(symbol);
        if (!stopped) handler({ symbol, price: quote.price, time: quote.time });
      } catch {
        // Keep the last price; retry on the next tick.
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, LIVE_POLL_MS);
    if (typeof (timer as unknown as { unref?: unknown }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
};
