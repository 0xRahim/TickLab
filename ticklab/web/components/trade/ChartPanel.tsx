"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ColorType,
  CrosshairMode,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { createChart } from "lightweight-charts";
import type { Symbol } from "./constants";
import { TIMEFRAME_SECONDS, formatPrice, getPriceDigits, type Timeframe } from "./constants";
import type {
  DrawingLine,
  DrawingTool,
  MagnetMode,
} from "./drawings/constants";
import { DRAWING_STYLES_EVENT, getStyleDefaults } from "./drawings/drawingStyles";
import { DrawingToolsManager } from "./lib/chart-plugins/drawing-tools/manager";
import { applyTick } from "./lib/candle-builder";
import { SessionMarkersPrimitive } from "./indicators/session-markers-primitive";
import { getSessionWindows } from "./indicators/sessions";
import { useSessionSettings } from "./indicators/session-settings-store";
import type { Candle } from "./services/types";

export interface DrawingCallbacks {
  onAdd: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onToolFinished: () => void;
  onSelectionChange: (ids: string[]) => void;
  onRequestSettings: (id: string) => void;
  onContextMenu: (id: string, clientX: number, clientY: number) => void;
  onSelectTool: (tool: DrawingTool) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface ChartPanelProps {
  symbol: Symbol;
  timeframe: Timeframe;
  candles: Candle[];
  livePrice: number | null;
  loading: boolean;
  /** When true, only auto-follow while stepping/playing forward. */
  replayActive: boolean;
  /** Active drawing tool armed from the rail / shortcuts. */
  tool: DrawingTool;
  /** Drawings visible on this timeframe (hidden + tf-scoped filtered out). */
  drawings: DrawingLine[];
  magnet: MagnetMode;
  accountEquity: number;
  drawingCallbacks: DrawingCallbacks;
  /** Terminal keeps the manager to drive external selection (object tree). */
  managerRef: RefObject<DrawingToolsManager | null>;
  /** Scroll-left backfill request (null when the source can't backfill). */
  onNeedOlder: (() => void) | null;
  loadingOlder: boolean;
  /** True when the feed has no older bars (end of upstream history). */
  olderExhausted: boolean;
  /** Open positions for the visible symbol → entry/SL/TP lines. */
  positions?: Array<{ id: string; entry: number; stop?: number; target?: number; side: "long" | "short" }>;
  /** Working orders for the visible symbol → resting lines. */
  orders?: Array<{ id: string; limitPrice?: number; stopPrice?: number; side: "long" | "short"; type: string }>;
}

function precisionFor(symbol: string, candles: Candle[]): number {
  return getPriceDigits(symbol, candles);
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

/**
 * Candle-only palette (grey up / black-or-white down, monochrome wicks and
 * borders). Deliberately separate from the `--up`/`--down` tokens, which
 * keep driving P&L text and ticket UI. Dark mode uses white instead of
 * black so down candles stay visible on the dark background.
 */
export function candleColors(): { up: string; down: string; wickBorder: string } {
  const dark = document.documentElement.classList.contains("dark");
  return {
    up: "#787b86",
    down: dark ? "#ffffff" : "#000000",
    wickBorder: dark ? "#ffffff" : "#000000",
  };
}

export function applyCandleColors(
  candleSeries: ISeriesApi<"Candlestick">,
  precision: number,
): void {
  const c = candleColors();
  candleSeries.applyOptions({
    upColor: c.up,
    downColor: c.down,
    wickUpColor: c.wickBorder,
    wickDownColor: c.wickBorder,
    borderVisible: true,
    borderUpColor: c.wickBorder,
    borderDownColor: c.wickBorder,
    priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
  });
}

function formatOhlc(
  symbol: string,
  bar: { open: number; high: number; low: number; close: number },
  digits: number,
): string {
  const f = (n: number) => formatPrice(n, digits);
  return `${symbol}  O ${f(bar.open)}  H ${f(bar.high)}  L ${f(bar.low)}  C ${f(bar.close)}`;
}

/** IANA zone for all UK-time chart labels (candles are UTC epochs). */
const UK_TZ = "Europe/London";

const ukYearFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: UK_TZ });
const ukMonthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: UK_TZ });
const ukDayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: UK_TZ,
});
const ukTimeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: UK_TZ,
});

/** Time-axis (and crosshair) labels in UK time. */
function ukTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string | null {
  if (typeof time !== "number") return null;
  const d = new Date(time * 1000);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return ukYearFmt.format(d);
    case TickMarkType.Month:
      return ukMonthFmt.format(d);
    case TickMarkType.DayOfMonth:
      return ukDayFmt.format(d);
    default:
      return ukTimeFmt.format(d);
  }
}

export default function ChartPanel({
  symbol,
  timeframe,
  candles,
  livePrice,
  loading,
  replayActive,
  tool,
  drawings,
  magnet,
  accountEquity,
  drawingCallbacks,
  managerRef,
  onNeedOlder,
  loadingOlder,
  olderExhausted,
  positions,
  orders,
}: ChartPanelProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const managerLocalRef = useRef<DrawingToolsManager | null>(null);
  const priceLineRef = useRef<ReturnType<
    ISeriesApi<"Candlestick">["createPriceLine"]
  > | null>(null);
  const overlayLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const barsRef = useRef<Candle[]>([]);
  /** Bar count at the last replay follow — scrubbing back must not yank. */
  const replayCountRef = useRef(0);
  /** Session Markers overlay primitive (attached to the candle series). */
  const sessionPrimitiveRef = useRef<SessionMarkersPrimitive | null>(null);
  const sessionSettings = useSessionSettings();
  /**
   * Replay follow-mode: true while the viewport tracks the leading edge
   * (including a user-dragged offset into the future). Scrolling back into
   * history flips it false so playback never yanks the viewport.
   * Ref mirror for chart-event/effect reads; state drives the UI pill.
   */
  const FOLLOW_THRESHOLD_BARS = 5;
  /** Fetch older history when the left viewport edge gets this close to bar 0. */
  const BACKFILL_EDGE_BARS = 30;
  const [isFollowing, setIsFollowing] = useState(true);
  const isFollowingRef = useRef(true);
  /** True while the viewport sits at the left (oldest) edge of history. */
  const [atLeftEdge, setAtLeftEdge] = useState(false);
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);
  const prevFirstTimeRef = useRef<number | null>(null);
  const wasReplayActiveRef = useRef(replayActive);
  // Latest values for the stable chart-event subscriber (avoids resubscribing
  // without recreating the chart on every render).
  const needOlderRef = useRef(onNeedOlder);
  useEffect(() => {
    needOlderRef.current = onNeedOlder;
  });

  // Latest callbacks for the manager's stable proxies (avoids stale closures
  // without recreating the manager every render).
  const cbRef = useRef(drawingCallbacks);
  useEffect(() => {
    cbRef.current = drawingCallbacks;
  });

  // Create chart + series + drawings manager. Recreated per symbol; timeframe
  // switches reuse the instance via updateTimeframe (no drawing blink).
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const vars = readVars();
    const chart = createChart(mount, {
      width: mount.clientWidth,
      height: mount.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: vars.background },
        textColor: vars.muted,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: vars.border, visible: false },
        horzLines: { color: vars.border, visible: false },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: vars.border },
      // UK display time (lightweight-charts v4 has no timeZone option, so we format here).
      timeScale: {
        borderColor: vars.border,
        timeVisible: true,
        tickMarkFormatter: ukTickMarkFormatter,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({ priceScaleId: "right" });
    candleSeriesRef.current = candleSeries;
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.1 } });

    const manager = new DrawingToolsManager({
      chart,
      series: candleSeries,
      container: mount,
      intervalSec: TIMEFRAME_SECONDS[timeframe],
      timeframe,
      accountEquity,
      callbacks: {
        onAdd: (d) => cbRef.current.onAdd(d),
        onUpdate: (d) => cbRef.current.onUpdate(d),
        onRemove: (id) => cbRef.current.onRemove(id),
        onToolFinished: () => cbRef.current.onToolFinished(),
        onSelectionChange: (ids) => cbRef.current.onSelectionChange(ids),
        onRequestSettings: (id) => cbRef.current.onRequestSettings(id),
        onContextMenu: (id, x, y) => cbRef.current.onContextMenu(id, x, y),
        onSelectTool: (t) => cbRef.current.onSelectTool(t),
        onUndo: () => cbRef.current.onUndo(),
        onRedo: () => cbRef.current.onRedo(),
      },
    });
    manager.setStyleDefaults(getStyleDefaults());
    managerLocalRef.current = manager;
    managerRef.current = manager;

    // Session Markers overlay (indicator): background boxes behind candles.
    const sessions = new SessionMarkersPrimitive();
    candleSeries.attachPrimitive(sessions);
    sessionPrimitiveRef.current = sessions;

    const onStyles = () => manager.setStyleDefaults(getStyleDefaults());
    window.addEventListener(DRAWING_STYLES_EVENT, onStyles);

    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    resize.observe(mount);

    const onCrosshairMove = (param: { seriesData: Map<unknown, unknown> }) => {
      const el = legendRef.current;
      if (!el) return;
      const data = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      const bar = data ?? barsRef.current.at(-1);
      el.textContent = bar ? formatOhlc(symbol, bar, precisionFor(symbol, barsRef.current)) : symbol;
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    // Follow-mode tracking: user-driven scrolls/drags update the ref + pill.
    // scrollPosition() is the distance (in bars) from the right edge to the
    // latest bar — negative when the user parked the last bar mid-screen
    // with empty future space, large positive when viewing history.
    const onVisibleRangeChange = () => {
      if (barsRef.current.length === 0) return;
      let pos: number | null = null;
      try {
        pos = chart.timeScale().scrollPosition();
      } catch {
        return;
      }
      const following = pos !== null && pos < FOLLOW_THRESHOLD_BARS;
      if (following !== isFollowingRef.current) {
        isFollowingRef.current = following;
        setIsFollowing(following);
      }
      // Scroll-left backfill: near the left edge with history loaded, ask
      // for the next older chunk. Allowed during replay so left context
      // keeps loading; the revealed future stays pre-loaded underneath.
      const needOlder = needOlderRef.current;
      const range = chart.timeScale().getVisibleLogicalRange();
      const atEdge = range != null && range.from < BACKFILL_EDGE_BARS;
      setAtLeftEdge((prev) => (prev === atEdge ? prev : atEdge));
      if (needOlder && barsRef.current.length > 0 && atEdge) {
        needOlder();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    // Retheme when the `dark` class toggles.
    const themeObs = new MutationObserver(() => {
      const v = readVars();
      chart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: v.background },
          textColor: v.muted,
        },
        grid: {
          vertLines: { color: v.border, visible: false },
          horzLines: { color: v.border, visible: false },
        },
        rightPriceScale: { borderColor: v.border },
        timeScale: { borderColor: v.border },
      });
      applyCandleColors(candleSeries, precisionFor(symbol, barsRef.current));
    });
    themeObs.observe(document.documentElement, { attributes: true });

    return () => {
      window.removeEventListener(DRAWING_STYLES_EVENT, onStyles);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      themeObs.disconnect();
      resize.disconnect();
      try {
        candleSeries.detachPrimitive(sessions);
      } catch {
        /* chart already removed */
      }
      sessionPrimitiveRef.current = null;
      manager.destroy();
      managerLocalRef.current = null;
      managerRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Armed tool → manager.
  useEffect(() => {
    managerLocalRef.current?.setTool(tool);
  }, [tool]);

  // Visible drawings → primitive (skipped mid-drag; the manager owns the
  // local copy until onUpdate syncs back).
  useEffect(() => {
    managerLocalRef.current?.setDrawings(drawings);
  }, [drawings]);

  // Session Markers → overlay primitive. Recomputed from the visible candles
  // so replay slicing applies automatically; hidden on daily+ timeframes
  // where intraday sessions don't map to bars.
  useEffect(() => {
    const prim = sessionPrimitiveRef.current;
    if (!prim) return;
    const intraday = timeframe !== "1d" && timeframe !== "1w";
    if (!sessionSettings.enabled || !intraday || candles.length === 0) {
      prim.setWindows([]);
      return;
    }
    prim.setShowLabels(sessionSettings.showLabels);
    prim.setIntervalSec(TIMEFRAME_SECONDS[timeframe]);
    prim.setWindows(getSessionWindows(candles, sessionSettings));
  }, [candles, timeframe, sessionSettings]);

  // Timeframe switch without recreation.
  useEffect(() => {
    managerLocalRef.current?.updateTimeframe(timeframe, TIMEFRAME_SECONDS[timeframe]);
  }, [timeframe]);

  useEffect(() => {
    managerLocalRef.current?.setMagnetMode(magnet);
  }, [magnet]);

  useEffect(() => {
    managerLocalRef.current?.setAccountEquity(accountEquity);
  }, [accountEquity]);

  // Push full series on symbol/timeframe/data change.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !chart) return;

    // Snapshot viewport + data shape BEFORE replacing the series so replay
    // can shift (not reset) the visible range and hold a user-dragged offset.
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const prevLen = barsRef.current.length;
    const prevFirstTime = prevFirstTimeRef.current;
    const firstTime = candles[0]?.time ?? null;
    const symbolChanged = prevSymbolRef.current !== symbol;
    const dataReset = prevFirstTime !== null && firstTime !== null && prevFirstTime !== firstTime;
    const justEnteredReplay = replayActive && !wasReplayActiveRef.current;

    barsRef.current = [...candles];
    const precision = precisionFor(symbol, candles);
    applyCandleColors(candleSeries, precision);
    candleSeries.setData(
      candles.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    if (priceLineRef.current) {
      candleSeries.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    const legend = legendRef.current;
    const lastBar = candles.at(-1);
    if (legend) legend.textContent = lastBar ? formatOhlc(symbol, lastBar, precision) : symbol;
    if (replayActive) {
      // Follow with preserved offset: shift the visible logical range right
      // by exactly the new-bar count so a last candle parked mid-screen
      // stays mid-screen. Never scrollToRealTime here — that pins the last
      // bar to the right edge and wipes the user's placement.
      const prependedOlder =
        !symbolChanged &&
        !justEnteredReplay &&
        prevLen > 0 &&
        prevFirstTime !== null &&
        firstTime !== null &&
        firstTime < prevFirstTime;
      if (prependedOlder && prevRange) {
        // Scroll-left backfill mid-replay: older bars shifted everything
        // right — hold the view instead of snapping to the latest bar.
        const delta = candles.length - prevLen;
        if (delta > 0) {
          chart.timeScale().setVisibleLogicalRange({
            from: prevRange.from + delta,
            to: prevRange.to + delta,
          });
        }
      } else if (justEnteredReplay || symbolChanged || dataReset || replayCountRef.current === 0) {
        // Fresh baseline only (enter replay / symbol / timeframe switch).
        chart.timeScale().scrollToRealTime();
        isFollowingRef.current = true;
        setIsFollowing(true);
      } else {
        const delta = candles.length - prevLen;
        if (delta > 0) {
          if (isFollowingRef.current && prevRange) {
            chart.timeScale().setVisibleLogicalRange({
              from: prevRange.from + delta,
              to: prevRange.to + delta,
            });
          }
          // Not following (viewing history): leave the viewport alone.
        } else if (delta < 0) {
          // Scrubbed/stepped back: keep small steps in place, but snap when
          // the new tail no longer intersects the viewport (avoids blanks).
          const lastIdx = candles.length - 1;
          if (prevRange && (prevRange.from > lastIdx || prevRange.to < lastIdx - 2)) {
            chart.timeScale().scrollToRealTime();
            isFollowingRef.current = true;
            setIsFollowing(true);
          }
        }
      }
      replayCountRef.current = candles.length;
    } else {
      replayCountRef.current = 0;
      const prepended =
        !symbolChanged &&
        prevTimeframeRef.current === timeframe &&
        prevLen > 0 &&
        prevFirstTime !== null &&
        firstTime !== null &&
        firstTime < prevFirstTime;
      if (prepended && prevRange) {
        // Backfill: same bars shifted right by the added count — hold the view.
        const delta = candles.length - prevLen;
        chart.timeScale().setVisibleLogicalRange({
          from: prevRange.from + delta,
          to: prevRange.to + delta,
        });
      } else {
        chart.timeScale().scrollToRealTime();
        if (!isFollowingRef.current) {
          isFollowingRef.current = true;
          setIsFollowing(true);
        }
      }
    }
    prevSymbolRef.current = symbol;
    prevTimeframeRef.current = timeframe;
    prevFirstTimeRef.current = firstTime;
    wasReplayActiveRef.current = replayActive;
  }, [candles, symbol, timeframe, replayActive]);

  // Live tick: advance the forming bar, printing a new candle when the
  // timeframe bucket rolls over (bar math lives in lib/candle-builder).
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || livePrice === null) return;
    const applied = applyTick(
      barsRef.current,
      livePrice,
      Date.now() / 1000,
      TIMEFRAME_SECONDS[timeframe],
    );
    if (!applied) return;
    candleSeries.update({
      time: applied.bar.time as UTCTimestamp,
      open: applied.bar.open,
      high: applied.bar.high,
      low: applied.bar.low,
      close: applied.bar.close,
    });
    const legend = legendRef.current;
    if (legend) legend.textContent = formatOhlc(symbol, applied.bar, precisionFor(symbol, barsRef.current));
    if (applied.isNewBar && isFollowingRef.current && chart) {
      chart.timeScale().scrollToRealTime();
    }
    const vars = readVars();
    if (priceLineRef.current) {
      candleSeries.removePriceLine(priceLineRef.current);
    }
    priceLineRef.current = candleSeries.createPriceLine({
      price: livePrice,
      color: vars.accent,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "",
    });
  }, [livePrice, timeframe, symbol]);

  const goToLatest = () => {
    chartRef.current?.timeScale().scrollToRealTime();
    isFollowingRef.current = true;
    setIsFollowing(true);
  };

  // Order / position overlays: entry + SL/TP lines per open position and
  // dotted resting lines per working order. Rebuilt when they change.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    for (const line of overlayLinesRef.current) {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        // Already removed with the series.
      }
    }
    overlayLinesRef.current = [];
    const vars = readVars();
    const add = (opts: Parameters<ISeriesApi<"Candlestick">["createPriceLine"]>[0]) => {
      try {
        overlayLinesRef.current.push(candleSeries.createPriceLine(opts));
      } catch {
        // Series gone — ignore.
      }
    };
    for (const p of positions ?? []) {
      const color = p.side === "long" ? vars.up : vars.down;
      add({ price: p.entry, color, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `${p.side === "long" ? "L" : "S"}` });
      if (p.stop != null) add({ price: p.stop, color: vars.down, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
      if (p.target != null) add({ price: p.target, color: vars.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
    }
    for (const o of orders ?? []) {
      const px = o.limitPrice ?? o.stopPrice;
      if (px == null) continue;
      add({
        price: px,
        color: vars.accent,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `${o.type} ${o.side === "long" ? "B" : "S"}`,
      });
    }
  }, [positions, orders, symbol]);

  return (
    <div className="relative h-full min-h-[420px] w-full flex-1">
      <div ref={mountRef} className="absolute inset-0" />
      <div
        ref={legendRef}
        className="pointer-events-none absolute left-2 top-2 z-10 font-mono text-xs tabular-nums text-foreground"
      >
        {loading ? "Loading bars…" : symbol}
      </div>
      {replayActive && !isFollowing && (
        <button
          type="button"
          onClick={goToLatest}
          aria-label="Follow replay to latest bar"
          title="Follow replay to latest bar"
          className="absolute bottom-8 right-16 z-10 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground shadow-lg hover:bg-border/50"
        >
          Go to latest
        </button>
      )}
      {loadingOlder && (
        <div
          role="status"
          className="absolute bottom-3 left-3 z-10 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-muted shadow-xl"
        >
          Loading older bars…
        </div>
      )}
      {!loadingOlder && olderExhausted && onNeedOlder && atLeftEdge && (
          <div
            role="status"
            className="absolute bottom-3 left-3 z-10 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-muted shadow-xl"
          >
            No older history available
          </div>
        )}
    </div>
  );
}
