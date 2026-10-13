"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ThemeToggle } from "@/components/trade/ThemeToggle";
import {
  deleteSession,
  fetchSessionTrades,
  getCoverage,
  listSessions,
  renameSession,
  retryDownload,
  type BacktestSession,
  type Coverage,
  type PersistedTrade,
} from "@/components/trade/services/session-api";
import { ActivityHeatmap } from "@/components/trade/dashboard/ActivityHeatmap";
import { DataStrip } from "@/components/trade/dashboard/DataStrip";
import { EquityCurve } from "@/components/trade/dashboard/EquityCurve";
import { IconButton } from "@/components/trade/dashboard/IconButton";
import { LogoMark } from "@/components/trade/LogoMark";
import { KpiRow } from "@/components/trade/dashboard/KpiRow";
import { NewSessionModal } from "@/components/trade/dashboard/NewSessionModal";
import { SessionCards } from "@/components/trade/dashboard/SessionCards";
import { buildDashboardStats } from "@/components/trade/dashboard/stats";

export default function DashboardPage() {
  const [sessions, setSessions] = useState<BacktestSession[]>([]);
  const [tradesBySession, setTradesBySession] = useState<Record<string, PersistedTrade[]>>({});
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const bump = () => setRefreshNonce((n) => n + 1);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const data = await listSessions();
        if (!on) return;
        setSessions(data);
        setError(null);
        const pairs = await Promise.all(data.map(async (s) => [s.id, await fetchSessionTrades(s.id)] as const));
        if (!on) return;
        setTradesBySession(Object.fromEntries(pairs));
        setLoading(false);
      } catch (e) {
        if (on) {
          setError(e instanceof Error ? e.message : "Failed to load sessions.");
          setLoading(false);
        }
      }
    })();
    getCoverage()
      .then((data) => {
        if (on) setCoverage(data);
      })
      .catch(() => {
        if (on) setCoverage([]);
      });
    return () => {
      on = false;
    };
  }, [refreshNonce]);

  // Poll while any session is sealing so progress lands without refresh.
  const sealing = sessions.some((s) => s.status === "downloading" || s.status === "draft");
  useEffect(() => {
    if (!sealing) return;
    const t = setInterval(bump, 2500);
    return () => clearInterval(t);
  }, [sealing]);

  const stats = useMemo(() => buildDashboardStats(sessions, tradesBySession), [sessions, tradesBySession]);

  const onRename = async (s: BacktestSession) => {
    const next = window.prompt("Rename session", s.name);
    if (!next || !next.trim() || next === s.name) return;
    try {
      const updated = await renameSession(s.id, next.trim());
      setSessions((all) => all.map((x) => (x.id === s.id ? updated : x)));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Rename failed.");
    }
  };

  const onDelete = async (s: BacktestSession) => {
    if (!window.confirm(`Delete "${s.name}"? Sealed candles stay cached; drawings and trades are removed.`)) return;
    try {
      await deleteSession(s.id);
      bump();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const onRetry = async (s: BacktestSession) => {
    try {
      await retryDownload(s.id);
      bump();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Retry failed.");
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 bg-surface px-6 py-8">
      <header className="flex items-center gap-2">
        <LogoMark />
        <h1 className="text-xl font-bold tracking-tight">TickLab</h1>
        <span className="hidden text-sm text-muted sm:inline">Offline bar-replay backtesting</span>
        <span className="ml-auto flex items-center gap-1.5">
          <IconButton title="New backtest" variant="primary" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
          </IconButton>
          <IconButton title="Update candlestick data" href="/data" variant="outline">
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <ThemeToggle />
        </span>
      </header>

      {error && (
        <p className="rounded-xl border border-down/40 bg-down/10 px-3 py-2 text-sm">
          {error} — start the TickLab backend (<code className="font-mono">bun src/bun/index.ts</code>).
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading dashboard…</p>
      ) : (
        <>
          <KpiRow stats={stats} />

          <div className="grid items-stretch gap-3 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3">
              <EquityCurve curve={stats.equityCurve} />
            </div>
            <div className="min-w-0 xl:col-span-2">
              <ActivityHeatmap days={stats.days} />
            </div>
          </div>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">Backtest sessions</h2>
            <SessionCards
              sessions={sessions}
              perSession={stats.perSession}
              onRename={(s) => void onRename(s)}
              onDelete={(s) => void onDelete(s)}
              onRetry={(s) => void onRetry(s)}
            />
          </section>

          <DataStrip coverage={coverage} />
        </>
      )}

      <NewSessionModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={bump} />
    </div>
  );
}
