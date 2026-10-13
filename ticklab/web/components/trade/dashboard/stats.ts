import { START_BALANCE } from "../services/paper-engine";
import type { BacktestSession, PersistedTrade } from "../services/session-api";

export interface SessionPerf {
  sessionId: string;
  closedTrades: number;
  openTrades: number;
  netPnl: number;
}

export interface DayBucket {
  key: string;
  dayStart: number;
  trades: number;
  pnl: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface SymbolPnl {
  symbol: string;
  pnl: number;
  trades: number;
}

export interface DashboardStats {
  perSession: Record<string, SessionPerf>;
  closedTrades: number;
  openTrades: number;
  netPnl: number;
  returnPct: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  equityCurve: EquityPoint[];
  bySymbol: SymbolPnl[];
  days: DayBucket[];
}

function dayKey(tsSec: number): { key: string; dayStart: number } {
  const d = new Date(tsSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { key, dayStart: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
}

/**
 * Pure aggregation for the dashboard: per-session performance, global KPIs,
 * daily buckets (heatmap), cumulative realized equity (curve + drawdown)
 * and per-symbol PnL — all from persisted closed trades.
 */
export function buildDashboardStats(
  sessions: BacktestSession[],
  tradesBySession: Record<string, PersistedTrade[]>,
): DashboardStats {
  const perSession: Record<string, SessionPerf> = {};
  const dayMap = new Map<string, DayBucket>();
  const bySym = new Map<string, { pnl: number; trades: number }>();
  const closed: Array<{ time: number; pnl: number }> = [];
  let n = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let winSum = 0;
  let lossSum = 0;
  let openTrades = 0;

  for (const s of sessions) {
    const trades = tradesBySession[s.id] ?? [];
    let net = 0;
    let closedN = 0;
    let open = 0;
    for (const t of trades) {
      if (t.exit != null && t.pnl != null) {
        const pnl = t.pnl;
        net += pnl;
        n += 1;
        closedN += 1;
        if (pnl > 0) {
          wins += 1;
          grossWin += pnl;
          winSum += pnl;
        } else if (pnl < 0) {
          grossLoss += -pnl;
          lossSum += -pnl;
        }
        const ct = t.closed_at ?? t.opened_at;
        closed.push({ time: ct, pnl });
        const dk = dayKey(ct);
        const b = dayMap.get(dk.key) ?? { key: dk.key, dayStart: dk.dayStart, trades: 0, pnl: 0 };
        b.trades += 1;
        b.pnl += pnl;
        dayMap.set(dk.key, b);
        const sy = bySym.get(t.symbol) ?? { pnl: 0, trades: 0 };
        sy.pnl += pnl;
        sy.trades += 1;
        bySym.set(t.symbol, sy);
      } else {
        open += 1;
      }
    }
    openTrades += open;
    perSession[s.id] = { sessionId: s.id, closedTrades: closedN, openTrades: open, netPnl: net };
  }

  closed.sort((a, b) => a.time - b.time);
  let equity = START_BALANCE;
  let peak = START_BALANCE;
  let maxDD = 0;
  const equityCurve: EquityPoint[] = [];
  for (const c of closed) {
    equity += c.pnl;
    equityCurve.push({ t: c.time * 1000, equity });
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  const netPnl = equity - START_BALANCE;
  const days = [...dayMap.values()].sort((a, b) => a.dayStart - b.dayStart);
  const bySymbol: SymbolPnl[] = [...bySym.entries()]
    .map(([symbol, v]) => ({ symbol, pnl: v.pnl, trades: v.trades }))
    .sort((a, b) => b.pnl - a.pnl);

  return {
    perSession,
    closedTrades: n,
    openTrades,
    netPnl,
    returnPct: (netPnl / START_BALANCE) * 100,
    winRate: n > 0 ? (wins / n) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin: wins > 0 ? winSum / wins : null,
    avgLoss: n - wins > 0 ? lossSum / (n - wins) : null,
    maxDrawdown: maxDD,
    maxDrawdownPct: peak > 0 ? (maxDD / peak) * 100 : 0,
    equityCurve,
    bySymbol,
    days,
  };
}
