"use client";

import { Database, RefreshCw } from "lucide-react";
import { SYMBOLS } from "../constants";
import type { Coverage } from "../services/session-api";
import { IconButton } from "./IconButton";
import { fmtBars, fmtDay } from "./format";

/** Compact market-data overview: what history exists and how far it reaches. */
export function DataStrip({ coverage }: { coverage: Coverage[] }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-accent/10 p-1.5 text-accent">
          <Database className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Market data</h2>
        <span className="text-xs text-muted">locally imported history</span>
        <span className="ml-auto">
          <IconButton title="Update candlestick data" href="/data" variant="outline">
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {SYMBOLS.map((s) => {
          const rows = coverage
            .filter((c) => c.symbol === s)
            .sort((a, b) => a.interval.localeCompare(b.interval));
          const m1 = rows.find((r) => r.interval === "1m");
          return (
            <div key={s} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-surface px-3 py-2 text-xs">
              <span className="font-semibold">{s}</span>
              {rows.length === 0 ? (
                <span className="text-muted">no local data yet</span>
              ) : (
                <>
                  <span className="text-muted">{rows.map((r) => r.interval).join(" · ")}</span>
                  <span className="ml-auto font-mono tabular-nums text-muted">
                    {m1 ? `${fmtBars(m1.bars)} bars · till ${fmtDay(m1.to)}` : `${rows.length} timeframes`}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
