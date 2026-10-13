"use client";

import { useEffect, useRef, useState } from "react";
import { useTerminal } from "../store";
import {
  fetchSessionProgress,
  saveSessionProgress,
  type SessionProgress,
} from "../services/session-api";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Per-session replay progress: persists the selected symbol/timeframe plus
 * the replay position (cutoff + revealed moment) to the backend, and
 * rehydrates them when the session is reopened so the user resumes where
 * they left off. Drawings/trades already persist per session; this closes
 * the remaining gap (chart position).
 */
export function useSessionProgress(sessionId: string) {
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Render-phase reset on session switch (derived-state pattern, same as
  // useSessionMarketData) — no mounted-ref guard: under StrictMode effects
  // run setup → cleanup → setup with refs preserved, so an early-return
  // guard would wedge `hydrated` at false forever.
  const [request, setRequest] = useState(sessionId);
  if (request !== sessionId) {
    setRequest(sessionId);
    setProgress(null);
    setHydrated(false);
  }

  // Hydrate once per session. The `cancelled` flag discards the stale first
  // run (StrictMode) or a superseded session fetch.
  useEffect(() => {
    let cancelled = false;
    fetchSessionProgress(sessionId)
      .then((p) => {
        if (cancelled) return;
        setProgress(p);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Mirror replay position + symbol/timeframe back (debounced, best-effort).
  const symbol = useTerminal((s) => s.symbol);
  const timeframe = useTerminal((s) => s.timeframe);
  const replayActive = useTerminal((s) => s.replayActive);
  const replayCutoff = useTerminal((s) => s.replayCutoff);
  const replayTime = useTerminal((s) => s.replayTime);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSessionProgress(sessionId, {
        symbol,
        timeframe,
        replay_cutoff: replayActive ? replayCutoff : null,
        replay_time: replayActive ? replayTime : null,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [sessionId, hydrated, symbol, timeframe, replayActive, replayCutoff, replayTime]);

  return { progress, hydrated };
}
