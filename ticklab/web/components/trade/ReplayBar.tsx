"use client";

import { Pause, Play, Radio, StepBack, StepForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTerminal } from "./store";
import type { Candle } from "./services/types";
import { cx } from "./lib/cx";

const PLAY_INTERVAL_MS = 600;

/** Hold-to-play (Space): candles per second range + default. */
const HOLD_CPS_MIN = 1;
const HOLD_CPS_MAX = 30;
const HOLD_CPS_DEFAULT = 6;
/**
 * Delay before hold-play starts advancing when Space was pressed while
 * already playing — a quick tap then stays a pure pause without sneaking
 * extra bars in.
 */
const HOLD_START_DELAY_MS = 350;

/** Ignore Space when focus sits in an editable control (same rule as the drawing manager). */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

function toLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(v: string): number | null {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function formatBarTime(ts: number | undefined): string {
  if (ts == null) return "—";
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Count of bars with time <= t (bars are ascending). */
function countAtOrBefore(bars: Candle[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function ReplayBar({
  bars,
  loadReplayWindow,
  loadLatest,
  exitLabel = "Go live",
  defaultStartTime,
}: {
  bars: Candle[];
  /** Load a two-sided window around the anchor for replay jumps. */
  loadReplayWindow: (anchor: number) => Promise<{
    candles: Candle[];
    startTime: number | null;
  }>;
  /** Reload the latest live window (Go live). Offline: reveals the full sealed range. */
  loadLatest: () => Promise<Candle[]>;
  /** Offline sessions pass "Show all" — same action, no live implication. */
  exitLabel?: string;
  /** Preferred initial replay moment (e.g. sealed session start). Falls
   * back to ~100 bars back when absent. */
  defaultStartTime?: number | null;
}) {
  const {
    replayActive,
    replayCutoff,
    replayTime,
    replayPlaying,
    replaySpeed,
    enterReplay,
    exitReplay,
    setReplayTime,
    setReplayPlaying,
    setReplaySpeed,
  } = useTerminal();

  const [draft, setDraft] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const [holdCps, setHoldCps] = useState(HOLD_CPS_DEFAULT);

  // Default the picker to the session start when provided (sealed `from`),
  // else ~100 bars back; falls back live during render (no effect) so data
  // arriving later still seeds a sensible moment.
  const fallbackAnchor = bars.length > 0 ? bars[Math.max(bars.length - 101, 0)]! : undefined;
  let hinted: Candle | undefined;
  if (defaultStartTime != null && bars.length > 0) {
    // First bar at/after the hint (the hint is a real bar time already, but
    // clamp defensively so an out-of-range hint can't blank the picker).
    const idx = countAtOrBefore(bars, defaultStartTime - 1);
    hinted = bars[Math.min(idx, bars.length - 1)]!;
  }
  const anchor = hinted ?? fallbackAnchor;
  const draftValue = draft ?? (anchor ? toLocalInput(anchor.time) : "");

  const shown = replayTime != null ? countAtOrBefore(bars, replayTime) : 0;
  const total = bars.length;

  // Playback: advance the revealed moment by `speed` bars per interval.
  useEffect(() => {
    if (!replayActive || !replayPlaying || total === 0) return;
    const t = window.setInterval(() => {
      const state = useTerminal.getState();
      const now = state.replayTime;
      if (now == null) return;
      const idx = countAtOrBefore(bars, now);
      const nextIdx = Math.min(idx + state.replaySpeed, total);
      if (nextIdx >= total) {
        state.setReplayTime(bars[total - 1]!.time);
        state.setReplayPlaying(false);
      } else {
        state.setReplayTime(bars[nextIdx]!.time);
      }
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [replayActive, replayPlaying, total, bars]);

  const step = (dir: 1 | -1) => {
    setReplayPlaying(false);
    if (replayTime == null || total === 0) return;
    const idx = countAtOrBefore(bars, replayTime);
    const nextIdx = Math.min(Math.max(idx + dir, 1), total);
    setReplayTime(bars[nextIdx - 1]!.time);
  };

  const start = async () => {
    const ts = fromLocalInput(draftValue);
    if (ts === null || bars.length === 0 || jumping) return;
    const first = bars[0]!.time;
    const last = bars[bars.length - 1]!.time;
    // Future pick: clamp to the live head instead of fetching an
    // empty/future window.
    if (ts > Math.floor(Date.now() / 1000)) {
      enterReplay(last);
      return;
    }
    if (ts >= first && ts <= last) {
      // Snap minute-precision input down to a real bar time so the
      // chosen moment is the start bar, not an off-by-one bucket.
      const idx = countAtOrBefore(bars, ts);
      enterReplay(idx === 0 ? first : bars[idx - 1]!.time);
      return;
    }
    // Outside loaded history: fetch left context + pre-loaded future
    // around the chosen moment, then enter at the interior anchor so
    // stepping forward has room. Failure falls back to the clamp.
    setJumping(true);
    try {
      const { candles: win, startTime } = await loadReplayWindow(ts);
      if (win.length > 0 && startTime != null) {
        enterReplay(startTime);
      } else {
        const idx = countAtOrBefore(bars, ts);
        if (idx === 0) enterReplay(first);
        else if (idx >= bars.length) enterReplay(last);
        else enterReplay(bars[idx - 1]!.time);
      }
    } finally {
      setJumping(false);
    }
  };

  // ── Spacebar step + hold-to-play ──────────────────────────────────────
  // Tap Space: one candle. Hold Space: keep revealing until release, at the
  // hold-speed slider rate. Latest closures mirrored into refs so the window
  // listeners below stay registered once (no resubscribe on every bar).
  const barsRef = useRef(bars);
  const holdCpsRef = useRef(holdCps);
  const stepRef = useRef(step);
  const startRef = useRef(start);
  const holdTimer = useRef<number | null>(null);
  // Latest closures for the stable Space listener (same mirror pattern as
  // ChartPanel's needOlderRef/cbRef).
  useEffect(() => {
    barsRef.current = bars;
    holdCpsRef.current = holdCps;
    stepRef.current = step;
    startRef.current = start;
  });

  useEffect(() => {
    const stopHold = () => {
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
    };
    // Advance one bar; stop + clamp at the data head. Reschedules itself
    // while the key stays held. The first tick always waits out
    // HOLD_START_DELAY_MS so a quick tap performs exactly one action.
    // `retries` covers the pre-start jump path: the replay window may
    // still be loading when the first ticks fire (~2s grace).
    const scheduleHoldTick = (delay: number, retries = 0) => {
      stopHold();
      holdTimer.current = window.setTimeout(() => {
        const state = useTerminal.getState();
        const list = barsRef.current;
        if (list.length === 0) {
          stopHold();
          return;
        }
        if (!state.replayActive || state.replayTime == null) {
          if (retries < 8) scheduleHoldTick(250, retries + 1);
          else stopHold();
          return;
        }
        const idx = countAtOrBefore(list, state.replayTime);
        if (idx >= list.length) {
          state.setReplayTime(list[list.length - 1]!.time);
          state.setReplayPlaying(false);
          stopHold();
          return;
        }
        state.setReplayTime(list[idx]!.time);
        scheduleHoldTick(1000 / holdCpsRef.current);
      }, delay);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (barsRef.current.length === 0) return;
      // Stop page scroll + focused-button activation: Space is ours here.
      e.preventDefault();
      const state = useTerminal.getState();
      if (!state.replayActive) {
        // Pre-start: begin replay at the picker moment; a tap leaves it
        // paused there, a hold keeps revealing until release.
        void startRef.current();
        scheduleHoldTick(HOLD_START_DELAY_MS);
        return;
      }
      if (state.replayPlaying) {
        // Tap = pure pause (delayed first tick); hold = pause then play.
        state.setReplayPlaying(false);
        scheduleHoldTick(HOLD_START_DELAY_MS);
        return;
      }
      // Paused: step now for a responsive tap, continue while held past
      // the tap window.
      stepRef.current(1);
      scheduleHoldTick(HOLD_START_DELAY_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      stopHold();
    };
    // Losing the window mid-hold (e.g. Alt-Tab) must stop playback: no
    // keyup will arrive.
    const onBlur = () => stopHold();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopHold();
    };
  }, []);

  if (!replayActive) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">Replay</span>
        <input
          type="datetime-local"
          aria-label="Replay start date and time"
          value={draftValue}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="button"
          onClick={() => void start()}
          disabled={bars.length === 0 || jumping}
          className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
        >
          {jumping ? "Loading…" : "Start replay"}
        </button>
        <span className="text-xs text-muted">
          Bars reveal from the chosen moment on every timeframe. Tip: Space starts replay, then steps / plays while held.
        </span>
      </div>
    );
  }

  const shownTime = shown > 0 ? bars[shown - 1]?.time : undefined;
  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">
        Replay
      </span>
      <button
        type="button"
        title={replayPlaying ? "Pause" : "Play"}
        aria-label={replayPlaying ? "Pause replay" : "Play replay"}
        onClick={() => setReplayPlaying(!replayPlaying)}
        className="rounded p-1.5 text-foreground hover:bg-border/50"
      >
        {replayPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        type="button"
        title="Step back one bar"
        aria-label="Step back one bar"
        onClick={() => step(-1)}
        className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-foreground"
      >
        <StepBack className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Step forward one bar"
        aria-label="Step forward one bar"
        onClick={() => step(1)}
        className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-foreground"
      >
        <StepForward className="h-4 w-4" />
      </button>
      <input
        type="range"
        aria-label="Replay position"
        min={1}
        max={Math.max(total, 1)}
        value={Math.min(Math.max(shown, 1), Math.max(total, 1))}
        onChange={(e) => {
          setReplayPlaying(false);
          const v = Number(e.target.value);
          if (total > 0) setReplayTime(bars[v - 1]!.time);
        }}
        className="w-40"
      />
      <select
        aria-label="Replay speed"
        value={replaySpeed}
        onChange={(e) => setReplaySpeed(Number(e.target.value))}
        className="rounded border border-border bg-background px-1 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent"
      >
        {[1, 2, 4].map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <label
        className="flex items-center gap-1 text-xs text-muted"
        title="Hold Space to reveal bars at this rate (tap Space for one bar)"
      >
        Hold
        <input
          type="range"
          aria-label="Hold-to-play speed in candles per second"
          min={HOLD_CPS_MIN}
          max={HOLD_CPS_MAX}
          value={holdCps}
          onChange={(e) => setHoldCps(Number(e.target.value))}
          className="w-20"
        />
        <span className="tabular-nums">{holdCps}/s</span>
      </label>
      <span className="hidden text-xs text-muted xl:inline">Space: step · hold: play</span>
      <span aria-live="polite" className="text-xs tabular-nums text-muted">
        {formatBarTime(replayCutoff ?? undefined)} start · bar {Math.min(shown, total)}/
        {total} · {formatBarTime(shownTime)}
      </span>
      <button
        type="button"
        onClick={() => {
          // Go live exits the backtest session; reload the latest live
          // window since replay replaced history.
          exitReplay();
          void loadLatest();
        }}
        className={cx(
          "ml-auto flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs",
          "hover:bg-border/50",
        )}
      >
        <Radio className="h-3.5 w-3.5" />
        {exitLabel}
      </button>
    </div>
  );
}
