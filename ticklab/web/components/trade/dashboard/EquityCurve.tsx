"use client";

import { TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { START_BALANCE } from "../services/paper-engine";
import type { EquityPoint } from "./stats";
import { fmtMoney } from "./format";

function compactUsd(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function TooltipBody({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number | string }>; label?: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0]?.value ?? 0);
  return (
    <div
      className="rounded-md px-2.5 py-1.5 text-xs shadow-lg"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--foreground)" }}
    >
      <p className="text-muted">{typeof label === "number" ? new Date(label).toLocaleString() : ""}</p>
      <p className="font-mono font-semibold tabular-nums">
        {fmtMoney(v)} <span className="font-normal text-muted">equity</span>
      </p>
    </div>
  );
}

/** Cumulative realized-PnL area chart (recharts). */
export function EquityCurve({ curve }: { curve: EquityPoint[] }) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-accent/10 p-1.5 text-accent">
          <TrendingUp className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Performance</h2>
        <span className="text-xs text-muted">cumulative realized PnL</span>
      </div>
      {curve.length === 0 ? (
        <p className="flex h-64 items-center justify-center text-sm text-muted">
          No closed trades yet — equity builds as backtests close positions.
        </p>
      ) : (
        <div className="h-64 w-full text-muted">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ticklabEquity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2962ff" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2962ff" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.25} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t: number) => new Date(t).toLocaleDateString()}
                tick={{ fill: "currentColor", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                tickFormatter={(v: number) => compactUsd(v)}
                tick={{ fill: "currentColor", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<TooltipBody />} />
              <ReferenceLine y={START_BALANCE} stroke="currentColor" strokeDasharray="4 4" opacity={0.5} />
              <Area type="monotone" dataKey="equity" stroke="#2962ff" strokeWidth={2} fill="url(#ticklabEquity)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
