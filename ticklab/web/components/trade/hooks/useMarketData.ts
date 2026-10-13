"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TIMEFRAME_SECONDS, type Symbol, type Timeframe } from "../constants";
import { api } from "../services/api";
import { ws } from "../services/ws";
import { bucketTime, mergeCandles } from "../lib/candle-builder";
import type { Candle } from "../services/types";

/** Bars per scroll-left backfill fetch (matches the initial load size). */
export const BACKFILL_CHUNK = 1000;

/** Replay window shape: left context + pre-loaded future for stepping. */
export const REPLAY_LOOKBACK_BARS = 300;
export const REPLAY_LOOKAHEAD_BARS = 700;

export interface ReplayWindow {
  candles: Candle[];
  /** Snapped replay start (a real bar time), or null when nothing loaded. */
  startTime: number | null;
}

export interface MarketData {
  candles: Candle[];
  /** True when bars came from real history. Always true (live-only feed). */
  real: boolean;
  loading: boolean;
  /** Prepend the next older live chunk (no-op unless source is "live"). */
  loadOlder: () => void;
  loadingOlder: boolean;
  /** True when the feed returned no older bars (end of upstream history). */
  olderExhausted: boolean;
  /**
   * Replace history with a window ending at `to` (1000 bars) for replay
   * jumps. Live-only; resolves with the final candles so callers can clamp.
   * Never rejects — failure resolves with the current candles.
   */
  loadWindow: (to: number) => Promise<Candle[]>;
  /**
   * Two-sided replay window around `anchor`: LOOKBACK bars before (left
   * context) + LOOKAHEAD bars after (pre-loaded future for stepping),
   * forward leg capped at now. Resolves with the merged candles and the
   * snapped start bar time. Never rejects.
   */
  loadReplayWindow: (anchor: number) => Promise<ReplayWindow>;
  /** Reload the latest live window (used when exiting replay / Go live). */
  loadLatest: () => Promise<Candle[]>;
}

interface Request {
  symbol: Symbol;
  timeframe: Timeframe;
}

const EMPTY: MarketData = {
  candles: [],
  real: false,
  loading: true,
  loadOlder: () => {},
  loadingOlder: false,
  olderExhausted: false,
  loadWindow: () => Promise.resolve([]),
  loadReplayWindow: () => Promise.resolve({ candles: [], startTime: null }),
  loadLatest: () => Promise.resolve([]),
};

interface BackfillState {
  exhausted: boolean;
  loading: boolean;
}

export function useMarketData(symbol: Symbol, timeframe: Timeframe): MarketData {
  const [request, setRequest] = useState<Request>({ symbol, timeframe });
  const [state, setState] = useState<MarketData>(EMPTY);
  const [backfill, setBackfill] = useState<BackfillState>({
    exhausted: false,
    loading: false,
  });

  // Reset to loading during render when inputs change (React-endorsed
  // derived-state pattern — keeps the reset out of effects).
  if (request.symbol !== symbol || request.timeframe !== timeframe) {
    setRequest({ symbol, timeframe });
    setState(EMPTY);
    setBackfill({ exhausted: false, loading: false });
  }

  // Latest snapshots for the async backfill path (refs updated in effects —
  // never mutated during render).
  const candlesRef = useRef<Candle[]>([]);
  useEffect(() => {
    candlesRef.current = state.candles;
  }, [state.candles]);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  const inflightRef = useRef(false);
  useEffect(() => {
    inflightRef.current = false;
  }, [request]);
  const windowSeqRef = useRef(0);

  useEffect(() => {
    let live = true;
    api
      .getCandles(request.symbol, request.timeframe)
      .then(({ candles, real }) => {
        if (live) setState((s) => ({ ...s, candles, real, loading: false }));
      })
      .catch(() => {
        if (live) setState((s) => ({ ...s, candles: [], real: false, loading: false }));
      });
    return () => {
      live = false;
    };
  }, [request]);

  const loadOlder = useCallback(() => {
    const req = requestRef.current;
    if (inflightRef.current || backfill.exhausted || backfill.loading) return;
    const current = candlesRef.current;
    if (current.length === 0) return;
    const earliest = current[0]!.time;
    const intervalSec = TIMEFRAME_SECONDS[req.timeframe];
    const to = new Date((earliest - 1) * 1000).toISOString();
    const from = new Date(
      (earliest - 1 - BACKFILL_CHUNK * intervalSec) * 1000,
    ).toISOString();
    inflightRef.current = true;
    setBackfill((b) => ({ ...b, loading: true }));
    api
      .getOlderCandles(req.symbol, req.timeframe, { from, to })
      .then((older) => {
        inflightRef.current = false;
        if (requestRef.current !== req) return; // stale (inputs changed)
        const merged = mergeCandles(candlesRef.current, older);
        const added = merged.length - candlesRef.current.length;
        setState((s) => ({ ...s, candles: mergeCandles(s.candles, older) }));
        setBackfill({ loading: false, exhausted: added === 0 });
      })
      .catch(() => {
        inflightRef.current = false;
        if (requestRef.current !== req) return;
        setBackfill((b) => ({ ...b, loading: false }));
      });
  }, [backfill.exhausted, backfill.loading]);

  const loadWindow = useCallback(
    async (to: number): Promise<Candle[]> => {
      const req = requestRef.current;
      if (!Number.isFinite(to)) return candlesRef.current;
      const seq = (windowSeqRef.current += 1);
      inflightRef.current = true;
      setBackfill((b) => ({ ...b, loading: true }));
      const intervalSec = TIMEFRAME_SECONDS[req.timeframe];
      const end = new Date(to * 1000).toISOString();
      const start = new Date((to - BACKFILL_CHUNK * intervalSec) * 1000).toISOString();
      try {
        const window = await api.getOlderCandles(req.symbol, req.timeframe, {
          from: start,
          to: end,
        });
        if (requestRef.current !== req || windowSeqRef.current !== seq) {
          return candlesRef.current; // stale (inputs changed / superseded)
        }
        setState((s) => ({ ...s, candles: window, real: true, loading: false }));
        setBackfill({ loading: false, exhausted: false });
        return window;
      } catch {
        return candlesRef.current;
      } finally {
        inflightRef.current = false;
        if (requestRef.current === req && windowSeqRef.current === seq) {
          setBackfill((b) => ({ ...b, loading: false }));
        }
      }
    },
    [],
  );

  const loadReplayWindow = useCallback(
    async (anchor: number): Promise<ReplayWindow> => {
      const req = requestRef.current;
      if (!Number.isFinite(anchor)) {
        return { candles: candlesRef.current, startTime: null };
      }
      const seq = (windowSeqRef.current += 1);
      inflightRef.current = true;
      setBackfill((b) => ({ ...b, loading: true }));
      const intervalSec = TIMEFRAME_SECONDS[req.timeframe];
      const nowSec = Math.floor(Date.now() / 1000);
      const snapped = bucketTime(Math.floor(anchor), intervalSec);
      const clampedAnchor = Math.min(snapped, bucketTime(nowSec, intervalSec));
      const backStart = clampedAnchor - REPLAY_LOOKBACK_BARS * intervalSec;
      try {
        const back = await api.getOlderCandles(req.symbol, req.timeframe, {
          from: new Date(backStart * 1000).toISOString(),
          to: new Date(clampedAnchor * 1000).toISOString(),
        });
        if (requestRef.current !== req || windowSeqRef.current !== seq) {
          return { candles: candlesRef.current, startTime: null }; // stale
        }
        let merged = mergeCandles([], back);
        // Forward leg: bars strictly after the anchor, capped at now so a
        // future pick doesn't request an empty/future window.
        const fwdFrom = clampedAnchor + 1;
        const fwdTo = Math.min(
          clampedAnchor + REPLAY_LOOKAHEAD_BARS * intervalSec,
          nowSec,
        );
        if (fwdFrom <= fwdTo) {
          try {
            const fwd = await api.getOlderCandles(req.symbol, req.timeframe, {
              from: new Date(fwdFrom * 1000).toISOString(),
              to: new Date(fwdTo * 1000).toISOString(),
            });
            if (requestRef.current !== req || windowSeqRef.current !== seq) {
              return { candles: candlesRef.current, startTime: null };
            }
            merged = mergeCandles(merged, fwd);
          } catch {
            // Forward leg is best-effort; back context alone still replays.
          }
        }
        if (merged.length === 0) {
          return { candles: candlesRef.current, startTime: null };
        }
        setState((s) => ({ ...s, candles: merged, real: true, loading: false }));
        // Fresh window — older history may still exist left of it until a
        // scroll-left backfill proves exhaustion.
        setBackfill({ loading: false, exhausted: false });
        const first = merged[0]!.time;
        const last = merged[merged.length - 1]!.time;
        const startTime = Math.min(Math.max(clampedAnchor, first), last);
        return { candles: merged, startTime };
      } catch {
        return { candles: candlesRef.current, startTime: null };
      } finally {
        inflightRef.current = false;
        if (requestRef.current === req && windowSeqRef.current === seq) {
          setBackfill((b) => ({ ...b, loading: false }));
        }
      }
    },
    [],
  );

  const loadLatest = useCallback(async (): Promise<Candle[]> => {
    const req = requestRef.current;
    const seq = (windowSeqRef.current += 1);
    inflightRef.current = true;
    setBackfill((b) => ({ ...b, loading: true }));
    try {
      const { candles } = await api.getCandles(req.symbol, req.timeframe);
      if (requestRef.current !== req || windowSeqRef.current !== seq) {
        return candlesRef.current; // stale (inputs changed / superseded)
      }
      setState((s) => ({ ...s, candles, real: true, loading: false }));
      setBackfill({ loading: false, exhausted: false });
      return candles;
    } catch {
      return candlesRef.current;
    } finally {
      inflightRef.current = false;
      if (requestRef.current === req && windowSeqRef.current === seq) {
        setBackfill((b) => ({ ...b, loading: false }));
      }
    }
  }, []);

  return {
    ...state,
    loadOlder,
    loadingOlder: backfill.loading,
    olderExhausted: backfill.exhausted,
    loadWindow,
    loadReplayWindow,
    loadLatest,
  };
}

export function useLivePrice(symbol: Symbol): number | null {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [price, setPrice] = useState<number | null>(null);

  if (activeSymbol !== symbol) {
    setActiveSymbol(symbol);
    setPrice(null);
  }

  useEffect(() => {
    return ws.subscribe(symbol, (tick) => setPrice(tick.price));
  }, [symbol]);

  return price;
}
