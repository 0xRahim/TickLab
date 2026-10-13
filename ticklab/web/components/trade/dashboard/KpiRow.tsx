"use client";

import { Layers, Percent, TrendingDown, Wallet, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import type { DashboardStats } from "./stats";
import { fmtMoney, fmtPct, fmtSigned } from "./format";

function Card({
  icon: Icon,
  label,
  value,
  valueClass,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueClass?: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-accent/10 p-1.5 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium text-muted">{label}</span>
      </div>
      <p className={cx("mt-2 font-mono text-2xl font-bold tabular-nums", valueClass ?? "text-foreground")}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

function pnlClass(n: number): string {
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-foreground";
}

/** Four headline KPIs from persisted closed trades. */
export function KpiRow({ stats }: { stats: DashboardStats }) {
  const { netPnl, returnPct, winRate, maxDrawdown, maxDrawdownPct, closedTrades, openTrades, avgWin, avgLoss } = stats;
  const avgLine =
    avgWin != null || avgLoss != null
      ? `avg win ${avgWin != null ? fmtMoney(avgWin) : "—"} · avg loss ${avgLoss != null ? fmtMoney(avgLoss) : "—"}`
      : "No closed trades yet";
  return (
    <section aria-label="Performance indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        icon={Wallet}
        label="Net PnL"
        value={`${fmtSigned(netPnl)} (${fmtPct(returnPct)})`}
        valueClass={pnlClass(netPnl)}
        sub={avgLine}
      />
      <Card
        icon={Percent}
        label="Win rate"
        value={winRate == null ? "—" : `${winRate.toFixed(1)}%`}
        sub={closedTrades === 0 ? "No closed trades yet" : `${closedTrades} closed trades`}
      />
      <Card
        icon={TrendingDown}
        label="Max drawdown"
        value={closedTrades === 0 ? "—" : `${fmtMoney(maxDrawdown)} (${maxDrawdownPct.toFixed(1)}%)`}
        valueClass={maxDrawdown > 0 ? "text-down" : "text-foreground"}
        sub="Peak-to-trough, realized"
      />
      <Card
        icon={Layers}
        label="Total trades"
        value={String(closedTrades)}
        sub={openTrades > 0 ? `${openTrades} open` : closedTrades === 0 ? "No trades yet" : "None open"}
      />
    </section>
  );
}
