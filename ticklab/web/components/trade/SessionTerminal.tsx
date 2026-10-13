"use client";

import { Bell, Clock, List, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTerminal as useTerminalState } from "./store";
import ChartPanel, { type DrawingCallbacks } from "./ChartPanel";
import { OrderTicket, type TicketDraft } from "./OrderTicket";
import { PositionsPanel } from "./PositionsPanel";
import { ReplayBar } from "./ReplayBar";
import { AccountBar } from "./AccountBar";
import { ToastStack } from "./ToastStack";
import { DrawingContextMenu, DrawingFloatingToolbar, DrawingSettingsDialog } from "./DrawingsOverlay";
import { DrawingToolRail } from "./DrawingToolRail";
import { ObjectTreePanel } from "./ObjectTreePanel";
import { SessionMarkersDialog } from "./SessionMarkersDialog";
import { useSessionSettings } from "./indicators/session-settings-store";
import { ThemeToggle } from "./ThemeToggle";
import { TIMEFRAME_SECONDS, formatPrice, getPriceDigits, type Symbol, type Timeframe } from "./constants";
import type { DrawingLine, DrawingTool, MagnetMode } from "./drawings/constants";
import { useSessionDrawings } from "./hooks/useSessionDrawings";
import { useSessionLineAlerts } from "./hooks/useSessionLineAlerts";
import { useSessionMarketData } from "./hooks/useSessionMarketData";
import { useSessionProgress } from "./hooks/useSessionProgress";
import type { DrawingToolsManager } from "./lib/chart-plugins/drawing-tools/manager";
import { usePaper } from "./services/paper-engine";
import { usePaperSync } from "./hooks/usePaperSync";
import { toastInfo } from "./lib/toast";
import type { BacktestSession } from "./services/session-api";
import { cx } from "./lib/cx";

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-background px-1.5 py-1 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

interface MenuState {
  id: string;
  x: number;
  y: number;
}

/**
 * Offline session terminal. Identical layout/behavior to Tradeye's
 * `Terminal`, but every data path reads the sealed SQLite bundle:
 * no live ticks, no quote polling, no network backfill. The replayed
 * bar close is the price everywhere (chart, ticket, paper engine).
 */
export default function SessionTerminal({ session }: { session: BacktestSession }) {
  const { symbol, timeframe, setSymbol, setTimeframe, replayActive, replayTime, enterReplay, setReplayTime } = useTerminalState();

  const sessionSymbols = useMemo(
    () => Array.from(new Set(session.instruments.map((i) => i.symbol))),
    [session],
  );
  const sessionTimeframes = useMemo(
    () => Array.from(new Set(session.instruments.map((i) => i.interval))),
    [session],
  );
  const range = useMemo(() => {
    const match =
      session.instruments.find((i) => i.symbol === symbol && i.interval === timeframe) ??
      session.instruments[0]!;
    return { from: match.from, to: match.to };
  }, [session, symbol, timeframe]);

  const { candles: fullCandles, sealedStartTime, loading, loadOlder, loadingOlder, olderExhausted, loadReplayWindow, loadLatest } =
    useSessionMarketData(session.id, symbol, timeframe, range);
  const { drawings, addDrawing, updateDrawing, removeDrawing, undo, redo } = useSessionDrawings(session.id, symbol);

  // Resume saved progress (or auto-start replay at the sealed `from` on
  // first open) once data arrives: the 1000-bar historic context stays
  // visible left, everything ahead of the revealed moment is hidden for
  // candle stepping. Runs once per session (not per TF switch, not after
  // the user exits via "Show all"). Saved symbol/timeframe apply first so
  // the resume position lands on the right instrument; drawings and trades
  // hydrate per session alongside this.
  const { progress, hydrated: progressHydrated } = useSessionProgress(session.id);
  const autoStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!progressHydrated || loading || fullCandles.length === 0 || sealedStartTime == null) return;
    if (autoStartRef.current === session.id) return;
    // Saved instrument first — market data reloads, then this effect
    // re-runs and resumes at the saved position. Clamped to the sealed
    // set so stale progress can never strand the terminal.
    if (progress && progress.symbol !== symbol && sessionSymbols.includes(progress.symbol)) {
      setSymbol(progress.symbol);
      return;
    }
    if (progress && progress.timeframe !== timeframe && (sessionTimeframes as string[]).includes(progress.timeframe)) {
      setTimeframe(progress.timeframe);
      return;
    }
    autoStartRef.current = session.id;
    const last = fullCandles[fullCandles.length - 1]!.time;
    const savedTime = progress?.replay_time;
    const start =
      savedTime != null && savedTime >= sealedStartTime && savedTime <= last ? savedTime : sealedStartTime;
    const savedCutoff = progress?.replay_cutoff;
    const cutoff =
      savedCutoff != null && savedCutoff >= sealedStartTime && savedCutoff <= start ? savedCutoff : start;
    enterReplay(cutoff);
    if (start !== cutoff) setReplayTime(start);
  }, [
    progressHydrated,
    progress,
    loading,
    fullCandles,
    sealedStartTime,
    session.id,
    sessionSymbols,
    sessionTimeframes,
    symbol,
    timeframe,
    setSymbol,
    setTimeframe,
    enterReplay,
    setReplayTime,
  ]);

  // Clamp symbol/timeframe into the sealed set.
  useEffect(() => {
    if (!sessionSymbols.includes(symbol)) setSymbol(sessionSymbols[0] ?? "BTCUSD");
  }, [sessionSymbols, symbol, setSymbol]);
  useEffect(() => {
    if (!sessionTimeframes.includes(timeframe)) setTimeframe(sessionTimeframes[0] ?? "1h");
  }, [sessionTimeframes, timeframe, setTimeframe]);

  // Replay slicing — same construction as Tradeye: every timeframe shows
  // bars at/before the revealed moment, so all TFs stay synced.
  // Memoized for stable identity across unrelated re-renders (see Terminal).
  const candles = useMemo(() => {
    const sliced =
      replayActive && replayTime != null ? fullCandles.filter((b) => b.time <= replayTime) : fullCandles;
    return sliced.length > 0 ? sliced : fullCandles.slice(0, 1);
  }, [fullCandles, replayActive, replayTime]);
  const chartPrice = candles.at(-1)?.close ?? null;

  // Mid-replay timeframe switch: re-slice is automatic (full range is in
  // memory); just ensure the replay moment stays clamped to the new TF.
  const loadReplayWindowRef = useRef(loadReplayWindow);
  useEffect(() => {
    loadReplayWindowRef.current = loadReplayWindow;
  });
  const replayTfRef = useRef<{ tf: Timeframe; active: boolean }>({ tf: timeframe, active: replayActive });
  useEffect(() => {
    const prev = replayTfRef.current;
    replayTfRef.current = { tf: timeframe, active: replayActive };
    if (prev.tf !== timeframe && replayActive && replayTime != null) {
      void loadReplayWindowRef.current(replayTime);
    }
  });

  // Paper engine MtM on every replay step: full bar range for SL/TP.
  const equity = usePaper((s) => s.equity);
  const chartPositions = usePaper((s) => s.positions);
  const chartOrders = usePaper((s) => s.orders);
  const lastBar = candles.at(-1);
  usePaperSync(session.id);
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (chartPrice == null || !lastBar) return;
    const key = `${symbol}|${lastBar.close}|${lastBar.high}|${lastBar.low}|${lastBar.time}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    usePaper.getState().mark(symbol, { price: lastBar.close, high: lastBar.high, low: lastBar.low, time: lastBar.time });
  }, [symbol, chartPrice, replayActive, candles, lastBar]);

  const [tool, setTool] = useState<DrawingTool>("none");
  const [magnet, setMagnet] = useState<MagnetMode>("none");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [ticketDraft, setTicketDraft] = useState<TicketDraft | null>(null);
  const sessionsEnabled = useSessionSettings((s) => s.enabled);
  const managerRef = useRef<DrawingToolsManager | null>(null);

  const [activeSymbol, setActiveSymbol] = useState(symbol);
  if (activeSymbol !== symbol) {
    setActiveSymbol(symbol);
    setTool("none");
    setSelectedIds([]);
    setSettingsId(null);
    setMenu(null);
  }

  const visibleDrawings = useMemo(
    () => drawings.filter((d) => !d.hidden && !(d.visibility === "tf" && d.createdTf !== timeframe)),
    [drawings, timeframe],
  );

  const alert = useSessionLineAlerts(chartPrice, visibleDrawings);

  const selectedDrawing = selectedIds.length === 1 ? drawings.find((d) => d.id === selectedIds[0]) : undefined;
  const settingsDrawing = settingsId ? drawings.find((d) => d.id === settingsId) : undefined;
  const menuDrawing = menu ? drawings.find((d) => d.id === menu.id) : undefined;

  const selectInManager = (ids: string[]) => {
    managerRef.current?.setSelection(ids);
  };

  const cloneDrawing = (d: DrawingLine) => {
    const dt = TIMEFRAME_SECONDS[timeframe] * 3;
    const copy: DrawingLine = {
      ...d,
      id: crypto.randomUUID(),
      time: d.time != null ? d.time + dt : undefined,
      time2: d.time2 != null ? d.time2 + dt : undefined,
      time3: d.time3 != null ? d.time3 + dt : undefined,
    };
    addDrawing(copy);
    selectInManager([copy.id]);
  };

  const reorderDrawing = (d: DrawingLine, dir: "front" | "back") => {
    const zs = drawings.map((x) => x.zIndex ?? 0);
    const next = dir === "front" ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
    updateDrawing({ ...d, zIndex: next });
  };

  const callbacks: DrawingCallbacks = {
    onAdd: addDrawing,
    onUpdate: updateDrawing,
    onRemove: removeDrawing,
    onToolFinished: () => setTool("none"),
    onSelectionChange: setSelectedIds,
    onRequestSettings: setSettingsId,
    onContextMenu: (id, clientX, clientY) => setMenu({ id, x: clientX, y: clientY }),
    onSelectTool: setTool,
    onUndo: undo,
    onRedo: redo,
  };

  const sealedBars = sealedStartTime != null ? fullCandles.filter((b) => b.time >= sealedStartTime).length : fullCandles.length;
  const contextBars = fullCandles.length - sealedBars;
  const caption = `Offline replay · ${session.name} · ${contextBars} context + ${sealedBars} sealed bars · no live feed.`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-4 py-2">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← Sessions
        </Link>
        <span className="text-sm font-semibold tracking-tight">TickLab</span>
        <span className="max-w-48 truncate text-xs text-muted" title={session.name}>
          {session.name}
        </span>
        <Select label="Symbol" value={symbol} onChange={(v) => setSymbol(v as Symbol)} options={sessionSymbols} />
        <Select
          label="Timeframe"
          value={timeframe}
          onChange={(v) => setTimeframe(v as Timeframe)}
          options={sessionTimeframes}
        />
        <span aria-live="polite" className="font-mono text-sm tabular-nums" title="Replayed price">
          {chartPrice === null ? "—" : formatPrice(chartPrice, getPriceDigits(symbol, candles))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {replayActive ? (
            <span className="rounded bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">Replay</span>
          ) : (
            <span className="text-xs text-muted">Sealed</span>
          )}
          <ThemeToggle />
        </span>
      </header>

      <div className="grid flex-1 grid-cols-[48px_minmax(0,1fr)_320px] gap-0">
        <aside aria-label="Drawing tools" className="border-r border-border bg-background py-2">
          <div className="flex justify-center">
            <DrawingToolRail drawingTool={tool} onDrawingTool={setTool} />
          </div>
        </aside>
        <main className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1 border-b border-border px-3 py-1">
            <Select
              label="Magnet"
              value={magnet}
              onChange={(v) => (v === "weak" || v === "strong" ? setMagnet(v) : setMagnet("none"))}
              options={["none", "weak", "strong"] as const}
            />
            <span className="mx-1 h-4 border-l border-border" />
            <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-foreground">
              <Undo2 className="h-4 w-4" />
            </button>
            <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={redo} className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-foreground">
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Objects"
              aria-label="Toggle objects panel"
              onClick={() => setTreeOpen((o) => !o)}
              className={cx("rounded p-1.5 hover:bg-border/50 hover:text-foreground", treeOpen ? "text-accent" : "text-muted")}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Session Markers settings"
              aria-label="Toggle session markers settings"
              onClick={() => setSessionsOpen((o) => !o)}
              className={cx("rounded p-1.5 hover:bg-border/50 hover:text-foreground", sessionsOpen || sessionsEnabled ? "text-accent" : "text-muted")}
            >
              <Clock className="h-4 w-4" />
            </button>
            {tool !== "none" && (
              <span className="ml-2 text-xs text-muted">Placing {tool} — click / drag on the chart, Esc to cancel</span>
            )}
            {selectedDrawing?.type === "position" && (
              <button
                type="button"
                title="Load this position drawing into the order ticket"
                onClick={() => {
                  setTicketDraft({
                    id: `${selectedDrawing.id}:${Date.now()}`,
                    side: selectedDrawing.side ?? "long",
                    entry: selectedDrawing.price,
                    stop: selectedDrawing.stopPrice,
                    target: selectedDrawing.targetPrice,
                    riskPct: selectedDrawing.riskPct ?? 1,
                    drawingId: selectedDrawing.id,
                  });
                  toastInfo("Position drawing loaded into the ticket — confirm and submit.");
                }}
                className="ml-2 rounded bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25"
              >
                Load to ticket
              </button>
            )}
          </div>
          <section aria-label="Chart" className="relative flex min-h-[420px] flex-1">
            <ChartPanel
              symbol={symbol}
              timeframe={timeframe}
              candles={candles}
              livePrice={chartPrice}
              loading={loading}
              replayActive={replayActive}
              tool={tool}
              drawings={visibleDrawings}
              magnet={magnet}
              accountEquity={equity}
              drawingCallbacks={callbacks}
              managerRef={managerRef}
              onNeedOlder={loadOlder}
              loadingOlder={loadingOlder}
              olderExhausted={olderExhausted}
              positions={chartPositions.filter((p) => p.symbol === symbol).map((p) => ({ id: p.id, entry: p.entry, stop: p.stop, target: p.target, side: p.side }))}
              orders={chartOrders.filter((o) => o.symbol === symbol && o.status === "pending").map((o) => ({ id: o.id, limitPrice: o.limitPrice, stopPrice: o.stopPrice, side: o.side, type: o.type }))}
            />
            {selectedDrawing && (
              <DrawingFloatingToolbar
                drawing={selectedDrawing}
                onUpdate={updateDrawing}
                onClone={() => cloneDrawing(selectedDrawing)}
                onRemove={() => removeDrawing(selectedDrawing.id)}
                onOpenSettings={() => setSettingsId(selectedDrawing.id)}
              />
            )}
            {settingsDrawing && (
              <DrawingSettingsDialog
                drawing={settingsDrawing}
                currentTf={timeframe}
                onUpdate={updateDrawing}
                onRemove={() => removeDrawing(settingsDrawing.id)}
                onClose={() => setSettingsId(null)}
              />
            )}
            {sessionsOpen && <SessionMarkersDialog onClose={() => setSessionsOpen(false)} />}
            {menuDrawing && menu && (
              <DrawingContextMenu
                drawing={menuDrawing}
                x={menu.x}
                y={menu.y}
                onClose={() => setMenu(null)}
                onSettings={() => setSettingsId(menuDrawing.id)}
                onDuplicate={() => cloneDrawing(menuDrawing)}
                onReorder={(dir) => reorderDrawing(menuDrawing, dir)}
                onToggleLock={() => updateDrawing({ ...menuDrawing, locked: !menuDrawing.locked })}
                onToggleAlert={() => updateDrawing({ ...menuDrawing, alertEnabled: !menuDrawing.alertEnabled })}
                onRemove={() => removeDrawing(menuDrawing.id)}
              />
            )}
            {treeOpen && (
              <ObjectTreePanel
                drawings={drawings}
                selectedIds={selectedIds}
                priceDigits={getPriceDigits(symbol, candles)}
                currentTf={timeframe}
                onSelect={(d) => selectInManager([d.id])}
                onUpdate={updateDrawing}
                onRemove={removeDrawing}
                onReorder={reorderDrawing}
                onClose={() => setTreeOpen(false)}
              />
            )}
            {alert && (
              <div role="status" className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-warn/50 bg-surface px-3 py-1.5 text-xs shadow-xl">
                <Bell className="h-3.5 w-3.5 text-warn" />
                {alert.message}
              </div>
            )}
          </section>
          <div aria-label="Replay controls" className="border-t border-border px-4 py-2">
            <ReplayBar bars={fullCandles} loadReplayWindow={loadReplayWindow} loadLatest={loadLatest} exitLabel="Show all" defaultStartTime={sealedStartTime} />
          </div>
        </main>
        <aside aria-label="Order ticket and positions" className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-border bg-background px-3 py-2">
          <OrderTicket symbol={symbol} price={chartPrice} draft={ticketDraft} onDraftConsumed={() => setTicketDraft(null)} barTime={lastBar?.time} />
          <div className="border-t border-border" />
          <PositionsPanel />
        </aside>
      </div>

      <AccountBar />
      <ToastStack />
      <footer className="border-t border-border px-4 py-1.5">
        <p className="text-xs text-muted">{caption}</p>
      </footer>
    </div>
  );
}
