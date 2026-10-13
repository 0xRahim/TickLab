"use client";

import { Pause, Play, StepBack, StepForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { createChart } from "lightweight-charts";
import {
  formatSamplePrice,
  formatSampleTime,
  getSampleCandles,
} from "@/lib/sample-ohlc";

interface ReplayChartProps {
  /** Bars visible before playback starts (deterministic first paint). */
  startBars?: number;
  /** ms per bar at 1x speed */
  barIntervalMs?: number;
  className?: string;
  symbol?: string;
  timeframeLabel?: string;
}

function readVars(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const get = (k: string) => s.getPropertyValue(k).trim();
  return {
    background: get("--background") || "#ffffff",
    foreground: get("--foreground") || "#171717",
    border: get("--border") || "#e5e7eb",
    muted: get("--muted") || "#6b7280",
    up: get("--up") || "#089981",
    down: get("--down") || "#f6465d",
    accent: get("--accent") || "#2962ff",
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const SPEEDS = [1, 2, 4] as const;

/**
 * The landing page's single hero chart: a realistic bar-replay terminal
 * window. Deterministic sample data, coordinated playback + pan + zoom,
 * pauses offscreen / when the tab hides.
 */
export function ReplayChart({
  startBars = 48,
  barIntervalMs = 420,
  className,
  symbol = "EURUSD",
  timeframeLabel = "1H",
}: ReplayChartProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);
  const playingRef = useRef(true);
  const speedRef = useRef<number>(1);
  const revealedRef = useRef<number>(startBars);
  const tickRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const pauseUntilRef = useRef<number>(0);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [revealed, setRevealed] = useState(startBars);
  const [mounted, setMounted] = useState(false);

  const data = getSampleCandles();
  const total = data.length;

  // Keep refs in sync with state (stable rAF loop).
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const paintLegend = useCallback(
    (count: number) => {
      const el = legendRef.current;
      if (!el) return;
      const bar = data[Math.min(Math.max(count - 1, 0), total - 1)];
      if (!bar) return;
      const up = bar.close >= bar.open;
      el.innerHTML =
        `<span style="opacity:.65">${symbol} · ${timeframeLabel} · </span>` +
        `<span>O ${formatSamplePrice(bar.open)}  H ${formatSamplePrice(bar.high)}  ` +
        `L ${formatSamplePrice(bar.low)}  C ${formatSamplePrice(bar.close)}</span> ` +
        `<span style="color:${up ? "var(--up)" : "var(--down)"};font-weight:600">${up ? "+▲" : "−▼"}</span>`;
    },
    [data, symbol, timeframeLabel, total],
  );

  // Create chart once.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduced = prefersReducedMotion();
    const vars = readVars();

    const chart = createChart(mount, {
      width: mount.clientWidth,
      height: mount.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: vars.muted,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: vars.border, visible: false },
        horzLines: { color: vars.border, visible: true },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: vars.muted, labelBackgroundColor: vars.muted },
        horzLine: { color: vars.muted, labelBackgroundColor: vars.muted },
      },
      rightPriceScale: { borderColor: vars.border },
      timeScale: { borderColor: vars.border, timeVisible: true },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: vars.up,
      downColor: vars.down,
      wickUpColor: vars.up,
      wickDownColor: vars.down,
      borderVisible: false,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    seriesRef.current = series;

    // State syncs below run in a scheduled frame callback (an external
    // subscription tick), not synchronously, to avoid cascading renders.
    let syncRaf = 0;
    const scheduleSync = (fn: () => void) => {
      syncRaf = requestAnimationFrame(fn);
    };

    if (reduced) {
      // Reduced motion: paint the full sweep statically, no autoplay.
      revealedRef.current = total;
      series.setData(data.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 72), to: total + 8 });
      playingRef.current = false;
      paintLegend(total);
      scheduleSync(() => {
        setRevealed(total);
        setPlaying(false);
        setMounted(true);
      });
    } else {
      series.setData(
        data.slice(0, startBars).map((b) => ({ ...b, time: b.time as UTCTimestamp })),
      );
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: 64 });
      paintLegend(revealedRef.current);
      scheduleSync(() => setMounted(true));
    }

    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    resize.observe(mount);

    const themeObs = new MutationObserver(() => {
      const v = readVars();
      chart.applyOptions({
        layout: { textColor: v.muted },
        grid: {
          vertLines: { color: v.border, visible: false },
          horzLines: { color: v.border, visible: true },
        },
        rightPriceScale: { borderColor: v.border },
        timeScale: { borderColor: v.border },
      });
      series.applyOptions({
        upColor: v.up,
        downColor: v.down,
        wickUpColor: v.up,
        wickDownColor: v.down,
      });
    });
    themeObs.observe(document.documentElement, { attributes: true });

    return () => {
      cancelAnimationFrame(syncRaf);
      resize.disconnect();
      themeObs.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visibility: pause when offscreen or tab hidden.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(mount);
    const onVis = () => {
      if (document.hidden) {
        // rAF auto-pauses; just reset frame clock to avoid a jump.
        lastFrameRef.current = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Main playback loop.
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const step = (now: number) => {
      rafRef.current = requestAnimationFrame(step);
      if (!visibleRef.current || document.hidden) {
        lastFrameRef.current = now;
        return;
      }
      if (!playingRef.current) {
        lastFrameRef.current = now;
        return;
      }
      if (now < pauseUntilRef.current) {
        lastFrameRef.current = now;
        return;
      }
      const last = lastFrameRef.current || now;
      const dt = now - last;
      lastFrameRef.current = now;
      const interval = barIntervalMs / speedRef.current;

      tickRef.current += dt;
      if (tickRef.current < interval) {
        // Forming-candle interpolation: ease the next bar's close from
        // open → close so candles "develop" instead of popping in.
        const series = seriesRef.current;
        const next = data[revealedRef.current];
        if (series && next && revealedRef.current < total) {
          const p = Math.min(1, tickRef.current / interval);
          const eased = 1 - Math.pow(1 - p, 2);
          const close = next.open + (next.close - next.open) * eased;
          try {
            series.update({
              time: next.time as UTCTimestamp,
              open: next.open,
              high: Math.max(next.open, close, next.high * p),
              low: Math.min(next.open, close, next.low * p + next.open * (1 - p)),
              close,
            });
          } catch {
            /* ignore mid-teardown updates */
          }
        }
        return;
      }
      tickRef.current = 0;

      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart) return;

      if (revealedRef.current >= total) {
        // Hold the completed sweep, then loop seamlessly.
        pauseUntilRef.current = now + 1600;
        revealedRef.current = startBars;
        try {
          series.setData(
            data.slice(0, startBars).map((b) => ({ ...b, time: b.time as UTCTimestamp })),
          );
          chart.timeScale().setVisibleLogicalRange({ from: 0, to: 64 });
        } catch {
          /* ignore */
        }
        setRevealed(startBars);
        paintLegend(startBars);
        return;
      }

      const bar = data[revealedRef.current]!;
      try {
        series.update({ ...bar, time: bar.time as UTCTimestamp });
      } catch {
        /* ignore */
      }
      revealedRef.current += 1;
      const count = revealedRef.current;
      setRevealed(count);
      paintLegend(count);

      // Coordinated pan + slow zoom: follow the leading edge while gently
      // widening the visible window early in the sweep, then hold steady.
      try {
        const progress = count / total;
        const width = progress < 0.35 ? 64 + progress * 60 : 85;
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, count - width + 8),
          to: count + 8,
        });
      } catch {
        /* ignore */
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [barIntervalMs, data, paintLegend, startBars, total]);

  const jumpTo = useCallback(
    (count: number) => {
      const clamped = Math.min(Math.max(count, 1), total);
      revealedRef.current = clamped;
      tickRef.current = 0;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (series && chart) {
        try {
          series.setData(
            data.slice(0, clamped).map((b) => ({ ...b, time: b.time as UTCTimestamp })),
          );
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, clamped - 72),
            to: clamped + 8,
          });
        } catch {
          /* ignore */
        }
      }
      setRevealed(clamped);
      paintLegend(clamped);
    },
    [data, paintLegend, total],
  );

  const stepBy = useCallback(
    (dir: 1 | -1) => {
      setPlaying(false);
      jumpTo(revealedRef.current + dir);
    },
    [jumpTo],
  );

  const current = data[Math.min(Math.max(revealed - 1, 0), total - 1)];

  return (
    <div className={className}>
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
        </span>
        <span className="font-mono text-xs font-semibold tracking-tight">
          {symbol} · {timeframeLabel}
        </span>
        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">
          Replay
        </span>
        <span
          aria-live="polite"
          className="ml-auto hidden font-mono text-[11px] tabular-nums text-muted sm:inline"
        >
          {current ? formatSampleTime(current.time) : "—"}
        </span>
      </div>

      {/* OHLC readout */}
      <div
        ref={legendRef}
        aria-live="polite"
        className="pointer-events-none px-3 pt-2 font-mono text-[11px] tabular-nums text-foreground"
      >
        {!mounted ? `${symbol} · ${timeframeLabel}` : ""}
      </div>

      {/* Chart mount (deterministic placeholder keeps SSR + first paint identical) */}
      <div ref={mountRef} className="h-[320px] w-full sm:h-[380px] lg:h-[420px]" role="img" aria-label={`${symbol} candlestick replay chart`} />

      {/* Replay controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause replay" : "Play replay"}
          title={playing ? "Pause" : "Play"}
          className="rounded p-1.5 text-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => stepBy(-1)}
          aria-label="Step back one bar"
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          <StepBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => stepBy(1)}
          aria-label="Step forward one bar"
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          <StepForward className="h-4 w-4" />
        </button>
        <input
          type="range"
          aria-label="Replay position"
          min={1}
          max={total}
          value={revealed}
          onChange={(e) => {
            setPlaying(false);
            jumpTo(Number(e.target.value));
          }}
          className="w-32 accent-[var(--accent)] sm:w-44"
        />
        <select
          aria-label="Replay speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded border border-border bg-background px-1 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <span aria-live="polite" className="ml-auto font-mono text-[11px] tabular-nums text-muted">
          bar {revealed}/{total}
        </span>
      </div>
    </div>
  );
}
