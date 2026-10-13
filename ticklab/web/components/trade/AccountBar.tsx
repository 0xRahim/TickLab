"use client";

import { usePaper } from "./services/paper-engine";

function money(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Persistent account strip: equity / balance / margin / level. */
export function AccountBar() {
  const equity = usePaper((s) => s.equity);
  const balance = usePaper((s) => s.balance);
  const used = usePaper((s) => s.usedMargin);
  const level = usePaper((s) => s.marginLevel);
  const count = usePaper((s) => s.positions.length);
  const pending = usePaper((s) => s.orders.length);
  const free = equity - used;
  return (
    <div
      aria-label="Account summary"
      className="flex items-center gap-4 overflow-x-auto border-t border-border bg-background px-3 py-1 font-mono text-[11px] tabular-nums"
    >
      <span><span className="text-muted">Equity </span>{money(equity)}</span>
      <span><span className="text-muted">Bal </span>{money(balance)}</span>
      <span><span className="text-muted">Used </span>{money(used)}</span>
      <span><span className="text-muted">Free </span>{money(free)}</span>
      <span><span className="text-muted">Level </span>{level == null ? "—" : `${level.toFixed(1)}%`}</span>
      <span className="ml-auto text-muted">
        {count} pos · {pending} working
      </span>
    </div>
  );
}
