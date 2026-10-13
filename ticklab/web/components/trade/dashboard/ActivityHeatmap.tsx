"use client";

import { Activity } from "lucide-react";
import type { DayBucket } from "./stats";
import { fmtSigned } from "./format";

const WEEKS = 26;
const DAY_MS = 86_400_000;

function cellBackground(trades: number, pnl: number, maxAbs: number): string {
  if (trades === 0) return "color-mix(in srgb, var(--border) 55%, transparent)";
  if (pnl === 0) return "color-mix(in srgb, var(--muted) 45%, transparent)";
  const ratio = maxAbs > 0 ? Math.min(Math.abs(pnl) / maxAbs, 1) : 0;
  const alpha = 0.25 + 0.75 * ratio;
  return pnl > 0 ? `rgba(8,153,129,${alpha.toFixed(2)})` : `rgba(246,83,109,${alpha.toFixed(2)})`;
}

/** GitHub-style activity calendar: last 26 weeks, cells shaded by day net PnL. */
export function ActivityHeatmap({ days }: { days: DayBucket[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = today.getTime();
  const startDay = endDay - (WEEKS * 7 - 1) * DAY_MS;
  const byDay = new Map(days.map((d) => [d.dayStart, d]));
  const maxAbs = days.reduce((m, d) => Math.max(m, Math.abs(d.pnl)), 0);
  const activeDays = days.filter((d) => d.trades > 0).length;
  const net = days.reduce((a, d) => a + d.pnl, 0);

  const cells: Array<{ key: number; ts: number; bucket: DayBucket | undefined; future: boolean }> = [];
  for (let i = 0; i < WEEKS * 7; i += 1) {
    const ts = startDay + i * DAY_MS;
    cells.push({ key: i, ts, bucket: byDay.get(ts), future: ts > endDay });
  }

  const rowLabel = (row: number): string => (row === 1 ? "Mon" : row === 3 ? "Wed" : row === 5 ? "Fri" : "");

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-accent/10 p-1.5 text-accent">
          <Activity className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="text-xs text-muted">last 6 months</span>
      </div>
      {activeDays === 0 ? (
        <p className="flex h-40 items-center justify-center text-sm text-muted">
          No trading activity yet — close a backtest trade to light up the calendar.
        </p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <div className="grid grid-rows-7 gap-[3px] pr-1 text-[10px] leading-3 text-muted">
              {Array.from({ length: 7 }, (_, r) => (
                <span key={r} className="flex h-3 items-center">
                  {rowLabel(r)}
                </span>
              ))}
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
              {cells.map((c) => {
                if (c.future) return <span key={c.key} className="h-3 w-3" />;
                const b = c.bucket;
                const trades = b?.trades ?? 0;
                const pnl = b?.pnl ?? 0;
                const date = new Date(c.ts).toLocaleDateString();
                const tip =
                  trades === 0 ? `${date} · no activity` : `${date} · ${trades} trade${trades === 1 ? "" : "s"} · ${fmtSigned(pnl)}`;
                return (
                  <span
                    key={c.key}
                    title={tip}
                    className="h-3 w-3 rounded-[3px]"
                    style={{ background: cellBackground(trades, pnl, maxAbs) }}
                  />
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <span>
              {activeDays} active days · net {fmtSigned(net)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              Less
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="h-3 w-3 rounded-[3px]"
                  style={{
                    background:
                      i === 0
                        ? "color-mix(in srgb, var(--border) 55%, transparent)"
                        : `rgba(8,153,129,${(0.25 + 0.75 * (i / 4)).toFixed(2)})`,
                  }}
                />
              ))}
              More
            </span>
          </div>
        </>
      )}
    </div>
  );
}
