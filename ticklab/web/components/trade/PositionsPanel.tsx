"use client";

import { useState } from "react";
import { unrealized, usePaper, type PendingOrder, type Position } from "./services/paper-engine";
import { toastErr, toastOk } from "./lib/toast";
import { cx } from "./lib/cx";

type Tab = "positions" | "orders" | "fills" | "history";

function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleString(undefined, { hour12: false });
  } catch {
    return String(ts);
  }
}

function PositionRow({ p }: { p: Position }) {
  const { marks, modifyPosition, closePosition, reversePosition } = usePaper();
  const mark = marks[p.symbol] ?? p.mark;
  const pnl = unrealized(p, mark);
  const [stop, setStop] = useState(p.stop != null ? String(p.stop) : "");
  const [target, setTarget] = useState(p.target != null ? String(p.target) : "");
  const [trail, setTrail] = useState(p.trailDist != null ? String(p.trailDist) : "");
  const [closeQty, setCloseQty] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  const commit = () => {
    const s = stop.trim() === "" ? undefined : Number.parseFloat(stop);
    const t = target.trim() === "" ? undefined : Number.parseFloat(target);
    const tr = trail.trim() === "" ? undefined : Number.parseFloat(trail);
    if (s !== undefined && !Number.isFinite(s)) return;
    if (t !== undefined && !Number.isFinite(t)) return;
    if (tr !== undefined && !Number.isFinite(tr)) return;
    const res = modifyPosition(p.id, { stop: s, target: t, trailDist: tr });
    if (!res.ok) toastErr(res.error ?? "Invalid SL/TP.");
  };

  const doClose = (qty?: number) => {
    closePosition(p.id, mark, "manual", qty);
    toastOk(qty != null ? `Closed ${qty} ${p.symbol}.` : `Closed ${p.symbol} position.`);
    setConfirmClose(false);
  };

  return (
    <div className="rounded border border-border px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={cx("font-semibold capitalize", p.side === "long" ? "text-up" : "text-down")}>
          {p.side}
        </span>
        <span className="font-mono tabular-nums">{p.symbol}</span>
        <span className="font-mono tabular-nums text-muted">{p.qty}</span>
        <span className={cx("ml-auto font-mono tabular-nums", pnl >= 0 ? "text-up" : "text-down")}>
          {money(pnl)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono tabular-nums text-muted">
        <span>
          {p.entry.toLocaleString()} → {mark.toLocaleString()}
        </span>
        {p.trailDist != null && <span className="text-accent">trail {p.trailDist}</span>}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <input type="number" step="any" aria-label="Stop price" placeholder="SL" value={stop}
          onChange={(e) => setStop(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        <input type="number" step="any" aria-label="Target price" placeholder="TP" value={target}
          onChange={(e) => setTarget(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        <input type="number" step="any" aria-label="Trail distance" placeholder="Trail" value={trail}
          onChange={(e) => setTrail(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <input type="number" step="any" min="0" aria-label="Partial close qty" placeholder="Qty" value={closeQty}
          onChange={(e) => setCloseQty(e.target.value)}
          className="w-20 rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        <button type="button" disabled={closeQty.trim() === ""}
          onClick={() => { const q = Number.parseFloat(closeQty); if (!Number.isFinite(q) || q <= 0 || q >= p.qty) { toastErr(`Qty must be between 0 and ${p.qty}.`); return; } doClose(q); setCloseQty(""); }}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-border/50 disabled:opacity-50">
          Partial
        </button>
        <button type="button"
          onClick={() => { const res = reversePosition(p.id, { price: mark, high: mark, low: mark }); if (!res.ok) toastErr(res.error ?? "Reverse rejected."); else toastOk(`Reversed ${p.symbol}.`); }}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-border/50">
          Reverse
        </button>
        {confirmClose ? (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => doClose()} className="rounded bg-down/15 px-1.5 py-0.5 text-down">Confirm</button>
            <button type="button" onClick={() => setConfirmClose(false)} className="rounded px-1 py-0.5 text-muted hover:bg-border/50">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmClose(true)} className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 hover:bg-border/50">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function OrderRow({ o }: { o: PendingOrder }) {
  const { cancelOrder, modifyOrder, marks } = usePaper();
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(o.limitPrice != null ? String(o.limitPrice) : "");
  const [trig, setTrig] = useState(o.stopPrice != null ? String(o.stopPrice) : "");
  const mark = marks[o.symbol];

  const save = () => {
    const res = modifyOrder(o.id, {
      limitPrice: limit.trim() === "" ? undefined : Number.parseFloat(limit),
      stopPrice: trig.trim() === "" ? undefined : Number.parseFloat(trig),
    });
    if (!res.ok) toastErr(res.error ?? "Invalid order edit.");
    else {
      toastOk("Order updated.");
      setEditing(false);
    }
  };

  return (
    <div className="rounded border border-border px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded bg-accent/15 px-1 font-mono uppercase text-accent">{o.type}</span>
        <span className={cx("font-semibold capitalize", o.side === "long" ? "text-up" : "text-down")}>{o.side}</span>
        <span className="font-mono tabular-nums">{o.qty} {o.symbol}</span>
        <span className="ml-auto font-mono tabular-nums text-muted">
          {o.limitPrice != null ? `@ ${o.limitPrice.toLocaleString()}` : o.stopPrice != null ? `trig ${o.stopPrice.toLocaleString()}` : ""}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
        placed {fmtTime(o.placedAt)} · {o.expiry}
        {mark != null && o.limitPrice != null && <span> · dist {Math.abs(mark - o.limitPrice).toLocaleString()}</span>}
        {o.stop != null || o.target != null ? <span> · SL/TP {o.stop ?? "—"}/{o.target ?? "—"}</span> : null}
      </div>
      {editing ? (
        <div className="mt-1 flex items-center gap-1">
          <input type="number" step="any" aria-label="Limit price" placeholder="Limit" value={limit} onChange={(e) => setLimit(e.target.value)}
            className="w-full rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs" />
          <input type="number" step="any" aria-label="Stop trigger" placeholder="Trigger" value={trig} onChange={(e) => setTrig(e.target.value)}
            className="w-full rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs" />
          <button type="button" onClick={save} className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-accent">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="shrink-0 rounded px-1 py-0.5 text-muted hover:bg-border/50">X</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className="rounded border border-border px-1.5 py-0.5 hover:bg-border/50">Modify</button>
          <button type="button" onClick={() => { cancelOrder(o.id); toastOk("Order cancelled."); }} className="rounded border border-border px-1.5 py-0.5 hover:bg-border/50">Cancel</button>
        </div>
      )}
    </div>
  );
}

export function PositionsPanel() {
  const { positions, orders, fills, closed, marks, closeAll } = usePaper();
  const [tab, setTab] = useState<Tab>("positions");
  const [confirmAll, setConfirmAll] = useState(false);
  const pending = orders.filter((o) => o.status === "pending");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border">
        {(["positions", "orders", "fills", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx("px-2 py-1.5 text-xs capitalize", tab === t ? "text-accent" : "text-muted hover:text-foreground")}
          >
            {t}
            {t === "positions" && positions.length > 0 && ` (${positions.length})`}
            {t === "orders" && pending.length > 0 && ` (${pending.length})`}
          </button>
        ))}
        {tab === "positions" && positions.length > 0 && (
          confirmAll ? (
            <span className="ml-auto flex items-center gap-1 px-1">
              <button type="button" onClick={() => { closeAll(marks); setConfirmAll(false); toastOk("All positions closed."); }} className="rounded bg-down/15 px-1.5 py-0.5 text-xs text-down">Confirm</button>
              <button type="button" onClick={() => setConfirmAll(false)} className="rounded px-1 py-0.5 text-xs text-muted hover:bg-border/50">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="ml-auto px-2 py-1 text-xs text-muted hover:text-foreground">
              Close all
            </button>
          )
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1.5">
        {tab === "positions" &&
          (positions.length === 0 ? (
            <p className="px-1 text-xs text-muted">No open positions.</p>
          ) : (
            positions.map((p) => <PositionRow key={p.id} p={p} />)
          ))}
        {tab === "orders" &&
          (pending.length === 0 ? (
            <p className="px-1 text-xs text-muted">No working orders. Place a limit/stop from the ticket.</p>
          ) : (
            pending.map((o) => <OrderRow key={o.id} o={o} />)
          ))}
        {tab === "fills" &&
          (fills.length === 0 ? (
            <p className="px-1 text-xs text-muted">No fills yet.</p>
          ) : (
            [...fills].reverse().slice(0, 100).map((f) => (
              <div key={f.id} className="px-1 font-mono text-xs tabular-nums">
                <span className="text-muted">{fmtTime(f.time)}</span>{" "}
                <span className={cx("capitalize", f.side === "long" ? "text-up" : "text-down")}>
                  {f.kind === "open" ? "Opened" : "Closed"} {f.side}
                </span>{" "}
                {f.qty} {f.symbol} @ {f.price.toLocaleString()}
                {f.reason && f.reason !== "manual" && <span className="text-muted"> ({f.reason})</span>}
              </div>
            ))
          ))}
        {tab === "history" &&
          (closed.length === 0 ? (
            <p className="px-1 text-xs text-muted">No closed trades.</p>
          ) : (
            [...closed].reverse().slice(0, 100).map((t) => (
              <div key={t.id} className="px-1 py-0.5 font-mono text-xs tabular-nums">
                <div className="flex items-center gap-2">
                  <span className="capitalize">{t.side}</span>
                  <span className="text-muted">{t.qty} {t.symbol}</span>
                  <span className={cx("ml-auto", t.pnl >= 0 ? "text-up" : "text-down")}>{money(t.pnl)}</span>
                </div>
                <div className="text-[11px] text-muted">
                  {t.entry.toLocaleString()} → {t.exit.toLocaleString()} · {t.reason} · {fmtTime(t.closeTime)}
                  {t.commission > 0 && <span> · fee {money(t.commission)}</span>}
                </div>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}
