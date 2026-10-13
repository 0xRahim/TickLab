"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SYMBOLS, TIMEFRAMES, type Symbol, type Timeframe } from "../constants";
import { createSession } from "../services/session-api";
import { IconButton } from "./IconButton";
import { cx } from "../lib/cx";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** New-backtest popup: the create form as an accessible modal dialog. */
export function NewSessionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<Symbol[]>(["EURUSD"]);
  const [timeframes, setTimeframes] = useState<Timeframe[]>(["1h"]);
  const [from, setFrom] = useState(() => toLocalInput(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    setFormError(null);
    if (symbols.length === 0) return setFormError("Select at least one instrument.");
    if (timeframes.length === 0) return setFormError("Select at least one timeframe.");
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      return setFormError("Invalid date range.");
    }
    setCreating(true);
    try {
      await createSession({
        name: name.trim() || "Untitled session",
        symbols,
        timeframes,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      });
      setName("");
      onCreated();
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create session.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="New backtest session">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">New backtest session</h2>
          <span className="ml-auto">
            <IconButton title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </span>
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. EURUSD Jan–Mar"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="text-xs text-muted">Instruments</span>
            <div className="flex flex-wrap gap-2">
              {SYMBOLS.map((s) => (
                <label
                  key={s}
                  className={cx(
                    "flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-sm",
                    symbols.includes(s) ? "border-accent bg-accent/10" : "border-border",
                  )}
                >
                  <input type="checkbox" checked={symbols.includes(s)} onChange={() => setSymbols((p) => toggle(p, s))} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1 text-sm">
            <span className="text-xs text-muted">Timeframes (sealed per timeframe)</span>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map((t) => (
                <label
                  key={t}
                  className={cx(
                    "flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-sm",
                    timeframes.includes(t) ? "border-accent bg-accent/10" : "border-border",
                  )}
                >
                  <input type="checkbox" checked={timeframes.includes(t)} onChange={() => setTimeframes((p) => toggle(p, t))} />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted">From</span>
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted">To</span>
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
          </div>
          {formError && <p className="text-sm text-down">{formError}</p>}
          <div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={creating}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create & seal"}
            </button>
            <p className="mt-1 text-xs text-muted">
              Sessions seal against manually imported local history, plus 1000 context bars before From for chart
              context. The session opens in replay at From — future bars stay hidden until you step forward.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
