"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Symbol, Timeframe } from "../constants";
import { TIMEFRAME_SECONDS } from "../constants";
import { fetchSessionCandles } from "../services/session-api";
import { mergeCandles } from "../lib/candle-builder";
import type { Candle } from "../services/types";
import type { ReplayWindow } from "./useMarketData";

/**
 * Offline market data for a sealed backtest session. Loads the sealed range
 * PLUS historic context left of `from` (1000 bars per timeframe) from SQLite
 * (paged, local-only) and serves every replay operation from memory — no
 * network after the initial load, no live polling. Scrolling left past the
 * loaded window pages older imported history on demand via `loadOlder`,
 * all the way back to the oldest bar.
 */
export interface SessionMarketData {
  candles: Candle[];
  /** First bar at/after the session `from` — the replay start. Bars before
   * it are left context. Null until loaded. */
  sealedStartTime: number | null;
  loading: boolean;
  /** Prepend the next older chunk (scroll-left backfill). No-op when
   * exhausted or a fetch is in flight. */
  loadOlder: () => void;
  loadingOlder: boolean;
  /** True when the oldest imported bar is loaded (start of history). */
  olderExhausted: boolean;
  loadWindow: (to: number) => Promise<Candle[]>;
  loadReplayWindow: (anchor: number) => Promise<ReplayWindow>;
  loadLatest: () => Promise<Candle[]>;
}

const PAGE_LIMIT = 20000;

/** Bars per scroll-left backfill fetch. */
const BACKFILL_CHUNK = 5000;

/** Historic context bars loaded left of the session `from` (mirrors the
 * backend's SESSION_CONTEXT_BARS in `src/bun/download.ts`). */
export const SESSION_CONTEXT_BARS = 1000;

export function useSessionMarketData(
  sessionId: string,
  symbol: Symbol,
  timeframe: Timeframe,
  range: { from: string; to: string },
): SessionMarketData {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfill, setBackfill] = useState({ exhausted: false, loading: false });
  const candlesRef = useRef<Candle[]>([]);
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // Render-time reset on input change (derived-state pattern, same as
  // Tradeye's useMarketData) — keeps resets out of effects for lint.
  const [request, setRequest] = useState({ sessionId, symbol, timeframe, from: range.from, to: range.to });
  if (
    request.sessionId !== sessionId ||
    request.symbol !== symbol ||
    request.timeframe !== timeframe ||
    request.from !== range.from ||
    request.to !== range.to
  ) {
    setRequest({ sessionId, symbol, timeframe, from: range.from, to: range.to });
    setCandles([]);
    setLoading(true);
    setBackfill({ exhausted: false, loading: false });
  }
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  const inflightRef = useRef(false);
  useEffect(() => {
    inflightRef.current = false;
  }, [request]);
  const backfillRef = useRef(backfill);
  useEffect(() => {
    backfillRef.current = backfill;
  }, [backfill]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Page backwards from the session end so arbitrarily long sealed
        // ranges (e.g. 1m over months) load completely, then keep paging
        // into the historic context window left of `from`. Deeper history
        // loads on demand via loadOlder (scroll-left).
        const fromSec = Math.floor(Date.parse(request.from) / 1000);
        const contextFloor = fromSec - SESSION_CONTEXT_BARS * (TIMEFRAME_SECONDS[request.timeframe] ?? 3600);
        let cursorTo: string | undefined = request.to;
        let merged: Candle[] = [];
        let reachedStart = false;
        for (let page = 0; page < 50; page++) {
          const chunk = await fetchSessionCandles(request.sessionId, request.symbol, request.timeframe, {
            to: cursorTo,
            limit: PAGE_LIMIT,
          });
          if (chunk.length === 0) {
            reachedStart = true;
            break;
          }
          merged = mergeCandles(chunk, merged);
          if (chunk.length < PAGE_LIMIT) {
            reachedStart = true;
            break;
          }
          const earliest = chunk[0]!.time;
          if (earliest <= contextFloor) break;
          cursorTo = new Date((earliest - 1) * 1000).toISOString();
        }
        if (live) {
          setCandles(merged);
          setLoading(false);
          setBackfill({ exhausted: reachedStart, loading: false });
        }
      } catch {
        if (live) {
          setCandles([]);
          setLoading(false);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [request]);

  const loadOlder = useCallback(() => {
    const req = requestRef.current;
    if (inflightRef.current || backfillRef.current.exhausted || backfillRef.current.loading) return;
    const current = candlesRef.current;
    if (current.length === 0) return;
    const earliest = current[0]!.time;
    inflightRef.current = true;
    setBackfill({ exhausted: false, loading: true });
    fetchSessionCandles(req.sessionId, req.symbol, req.timeframe, {
      to: new Date((earliest - 1) * 1000).toISOString(),
      limit: BACKFILL_CHUNK,
    })
      .then((older) => {
        inflightRef.current = false;
        if (requestRef.current !== req) return; // stale (inputs changed)
        const before = candlesRef.current.length;
        const merged = mergeCandles(candlesRef.current, older);
        const added = merged.length - before;
        setCandles(merged);
        // Empty/short chunk or nothing new ⇒ oldest imported bar reached.
        setBackfill({ loading: false, exhausted: older.length < BACKFILL_CHUNK || added === 0 });
      })
      .catch(() => {
        inflightRef.current = false;
        if (requestRef.current !== req) return;
        setBackfill((b) => ({ ...b, loading: false }));
      });
  }, []);

  const loadWindow = useCallback(async (): Promise<Candle[]> => {
    // Offline: the full window (context + sealed range) is already in
    // memory; jumps just clamp.
    return candlesRef.current;
  }, []);

  const loadReplayWindow = useCallback(
    async (anchor: number): Promise<ReplayWindow> => {
      const all = candlesRef.current;
      if (all.length === 0 || !Number.isFinite(anchor)) return { candles: all, startTime: null };
      const first = all[0]!.time;
      const last = all[all.length - 1]!.time;
      if (anchor < first || anchor > last) return { candles: all, startTime: null };
      return { candles: all, startTime: anchor };
    },
    [],
  );

  const loadLatest = useCallback(async (): Promise<Candle[]> => {
    // Offline "Go live" = reveal the full window incl. context (no network).
    return candlesRef.current;
  }, []);

  // First bar at/after the session `from`: the replay start. Everything
  // before it is left context. Binary search (candles ascending).
  let sealedStartTime: number | null = null;
  if (candles.length > 0) {
    const fromSec = Math.floor(Date.parse(request.from) / 1000);
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid]!.time < fromSec) lo = mid + 1;
      else hi = mid;
    }
    sealedStartTime = lo < candles.length ? candles[lo]!.time : candles[candles.length - 1]!.time;
  }

  return {
    candles,
    sealedStartTime,
    loading,
    loadOlder,
    loadingOlder: backfill.loading,
    olderExhausted: backfill.exhausted,
    loadWindow,
    loadReplayWindow,
    loadLatest,
  };
}
