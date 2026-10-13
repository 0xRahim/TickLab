"use client";

import Link from "next/link";
import { Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { cx } from "../lib/cx";
import type { BacktestSession } from "../services/session-api";
import { IconButton } from "./IconButton";
import { fmtSigned, fmtTime } from "./format";
import type { SessionPerf } from "./stats";

function StatusBadge({ status }: { status: BacktestSession["status"] }) {
  const style =
    status === "ready"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "downloading" || status === "draft"
        ? "bg-accent/15 text-accent"
        : status === "partial"
          ? "bg-warn/15 text-warn"
          : "bg-down/15 text-down";
  return <span className={cx("rounded px-1.5 py-0.5 text-xs font-semibold capitalize", style)}>{status}</span>;
}

function pnlClass(n: number): string {
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-muted";
}

/** Backtest session card grid with icon-only actions. */
export function SessionCards({
  sessions,
  perSession,
  onRename,
  onDelete,
  onRetry,
}: {
  sessions: BacktestSession[];
  perSession: Record<string, SessionPerf>;
  onRename: (s: BacktestSession) => void;
  onDelete: (s: BacktestSession) => void;
  onRetry: (s: BacktestSession) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-8 text-center shadow-sm">
        <p className="text-sm font-medium">No backtest sessions yet</p>
        <p className="mt-1 text-xs text-muted">Create one with the + button above to start replaying sealed history.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sessions.map((s) => {
        const perf = perSession[s.id];
        return (
          <article key={s.id} className="flex flex-col rounded-xl border border-border bg-background p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={s.name}>
                {s.name}
              </span>
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-1 truncate text-xs text-muted" title={s.instruments.map((i) => `${i.symbol} ${i.interval}`).join(" · ")}>
              {s.instruments.map((i) => `${i.symbol} ${i.interval} (${i.cached_bars} bars)`).join(" · ")}
            </p>
            <p className="mt-0.5 text-xs text-muted">Updated {fmtTime(s.updated_at)}</p>
            {s.error && <p className="mt-0.5 text-xs text-down">{s.error}</p>}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs">
              <span className="text-muted">{perf?.closedTrades ?? 0} trades</span>
              <span className={cx("font-mono font-semibold tabular-nums", pnlClass(perf?.netPnl ?? 0))}>
                {fmtSigned(perf?.netPnl ?? 0)}
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                {(s.status === "ready" || s.status === "partial") && (
                  <Link
                    href={`/session/?id=${s.id}`}
                    title="Open session"
                    aria-label={`Open ${s.name}`}
                    className="inline-flex items-center justify-center rounded-md bg-accent p-2 text-white transition-colors hover:opacity-90"
                  >
                    <Play className="h-4 w-4" />
                  </Link>
                )}
                {(s.status === "failed" || s.status === "partial") && (
                  <IconButton title="Retry seal" onClick={() => onRetry(s)}>
                    <RotateCcw className="h-4 w-4" />
                  </IconButton>
                )}
                <IconButton title="Rename session" onClick={() => onRename(s)}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <IconButton title="Delete session" variant="danger" onClick={() => onDelete(s)}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
