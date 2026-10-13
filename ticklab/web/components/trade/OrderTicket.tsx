"use client";

import { useEffect, useMemo, useState } from "react";
import { usePaper, type OrderType, type Side } from "./services/paper-engine";
import { getInstrument, commissionFor } from "./lib/instruments";
import { qtyFromRisk, rewardRisk, riskAmount } from "./lib/risk";
import { toastErr, toastOk } from "./lib/toast";
import { cx } from "./lib/cx";
import { formatPrice, getPriceDigits, type Symbol } from "./constants";

export interface TicketDraft {
  id: string;
  side: Side;
  entry?: number;
  stop?: number;
  target?: number;
  riskPct?: number;
  drawingId?: string;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

const TYPE_TABS: OrderType[] = ["market", "limit", "stop", "stop-limit"];

export function OrderTicket({
  symbol,
  price,
  draft,
  onDraftConsumed,
  barTime,
}: {
  symbol: Symbol;
  price: number | null;
  draft?: TicketDraft | null;
  onDraftConsumed?: () => void;
  /** Bar time for replay-chronology fills. */
  barTime?: number;
}) {
  const { balance, equity, usedMargin, marginLevel, marketOrder, placeOrder, reset } = usePaper();
  const [side, setSide] = useState<Side>("long");
  const [type, setType] = useState<OrderType>("market");
  const [qty, setQty] = useState("0.01");
  const [riskPct, setRiskPct] = useState("1");
  const [sizeMode, setSizeMode] = useState<"risk" | "qty">("risk");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [useStop, setUseStop] = useState(false);
  const [useTarget, setUseTarget] = useState(false);
  const [useTrail, setUseTrail] = useState(false);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [trail, setTrail] = useState("");
  const [expiry, setExpiry] = useState<"GTC" | "IOC">("GTC");
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Drawing → ticket prefill (one-way).
  useEffect(() => {
    if (!draft) return;
    // Prefill is an intentional external sync, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSide(draft.side);
    if (draft.riskPct != null) {
      setRiskPct(String(draft.riskPct));
      setSizeMode("risk");
    }
    if (draft.entry != null) {
      setType("limit");
      setLimitPrice(String(draft.entry));
    }
    if (draft.stop != null) {
      setStop(String(draft.stop));
      setUseStop(true);
    }
    if (draft.target != null) {
      setTarget(String(draft.target));
      setUseTarget(true);
    }
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  const digits = getPriceDigits(symbol, []);
  const spec = getInstrument(symbol);
  const qtyNum = Number.parseFloat(qty);
  const riskNum = Number.parseFloat(riskPct);
  const entryRef =
    type === "market" ? price : type === "limit" ? Number.parseFloat(limitPrice) : type === "stop" ? Number.parseFloat(stopPrice) : Number.parseFloat(limitPrice);
  const stopNum = useStop ? Number.parseFloat(stop) : NaN;
  const targetNum = useTarget ? Number.parseFloat(target) : NaN;
  const entryNum: number = entryRef ?? NaN;

  // Risk ↔ qty linkage: editing risk recomputes qty when entry+stop known.
  const computedQty = useMemo(() => {
    if (sizeMode !== "risk") return null;
    if (!Number.isFinite(entryNum)) return null;
    if (!Number.isFinite(stopNum) || !Number.isFinite(riskNum)) return null;
    return qtyFromRisk(symbol, equity, riskNum, entryNum, stopNum);
  }, [sizeMode, entryNum, stopNum, riskNum, symbol, equity]);

  const effQty = sizeMode === "risk" && computedQty != null && computedQty > 0 ? computedQty : qtyNum;
  const notional = price != null && Number.isFinite(effQty) ? price * effQty : NaN;
  const reqMargin = Number.isFinite(notional) ? Math.abs(notional) / spec.defaultLeverage : NaN;
  const openFee = Number.isFinite(entryNum) && Number.isFinite(effQty) ? commissionFor(symbol, entryNum, effQty) : NaN;
  const riskCash = Number.isFinite(entryNum) && Number.isFinite(stopNum) && Number.isFinite(effQty) ? riskAmount(entryNum, stopNum, effQty) : NaN;
  const rr = Number.isFinite(entryNum) && Number.isFinite(stopNum) && Number.isFinite(targetNum) ? rewardRisk(entryNum, stopNum, targetNum) : NaN;
  const free = equity - usedMargin;

  const quickBracket = () => {
    const ref = Number.isFinite(entryNum) ? entryNum : price;
    if (ref == null || !Number.isFinite(ref)) return;
    const pct = 0.01;
    if (side === "long") {
      setStop(String(ref * (1 - pct)));
      setTarget(String(ref * (1 + pct)));
    } else {
      setStop(String(ref * (1 + pct)));
      setTarget(String(ref * (1 - pct)));
    }
    setUseStop(true);
    setUseTarget(true);
  };

  const submit = () => {
    setError(null);
    if (price == null) {
      const msg = "No price available.";
      setError(msg);
      toastErr(msg);
      return;
    }
    const quote = { price, high: price, low: price, time: barTime };
    const base = {
      stop: useStop && Number.isFinite(stopNum) ? stopNum : undefined,
      target: useTarget && Number.isFinite(targetNum) ? targetNum : undefined,
      trailDist: useTrail && Number.isFinite(Number.parseFloat(trail)) ? Number.parseFloat(trail) : undefined,
      riskPct: Number.isFinite(riskNum) ? riskNum : 1,
      drawingId: draft?.drawingId,
      time: barTime,
    };
    if (!Number.isFinite(effQty) || effQty <= 0) {
      const msg = "Enter a valid qty (or risk % with entry + stop).";
      setError(msg);
      toastErr(msg);
      return;
    }
    if (type === "market") {
      const res = marketOrder(symbol, side, effQty, quote, base);
      if (!res.ok) {
        setError(res.error ?? "Order rejected.");
        toastErr(res.error ?? "Order rejected.");
      } else {
        toastOk(`Market ${side} ${effQty} ${symbol} filled.`);
      }
      return;
    }
    const res = placeOrder(symbol, side, type, effQty, quote, {
      ...base,
      limitPrice: type !== "stop" && limitPrice.trim() !== "" ? Number.parseFloat(limitPrice) : undefined,
      stopPrice: type !== "limit" && stopPrice.trim() !== "" ? Number.parseFloat(stopPrice) : undefined,
      expiry,
    });
    if (!res.ok) {
      setError(res.error ?? "Order rejected.");
      toastErr(res.error ?? "Order rejected.");
    } else if (res.positionId) {
      toastOk(`Through-market ${type} filled at ${formatPrice(Number.parseFloat(limitPrice || stopPrice || "0"), digits)}.`);
    } else {
      toastOk(`${type} ${side} resting — fills on touch.`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Order ticket</span>
        {confirmReset ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => { reset(); setConfirmReset(false); toastOk("Paper account reset to $100,000."); }} className="rounded bg-down/15 px-1.5 py-0.5 text-xs text-down">Confirm</button>
            <button type="button" onClick={() => setConfirmReset(false)} className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-border/50">Cancel</button>
          </span>
        ) : (
          <button type="button" title="Reset paper account to $100,000" onClick={() => setConfirmReset(true)} className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-border/50 hover:text-foreground">
            Reset
          </button>
        )}
      </div>

      {draft && (
        <p className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-xs">
          Prefilled from {side} position drawing — confirm and submit.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Equity</dt>
        <dd className="text-right">{money(equity)}</dd>
        <dt className="text-muted">Balance</dt>
        <dd className="text-right">{money(balance)}</dd>
        <dt className="text-muted">Used / Free</dt>
        <dd className="text-right">{money(usedMargin)} / {money(free)}</dd>
        <dt className="text-muted">Margin level</dt>
        <dd className="text-right">{marginLevel == null ? "—" : `${marginLevel.toFixed(1)}%`}</dd>
      </dl>

      <div className="grid grid-cols-2 gap-1 rounded border border-border p-0.5">
        {(["long", "short"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cx(
              "rounded px-2 py-1 text-xs font-semibold capitalize",
              side === s ? (s === "long" ? "bg-up/20 text-up" : "bg-down/20 text-down") : "text-muted hover:bg-border/50",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1 rounded border border-border p-0.5" role="tablist" aria-label="Order type">
        {TYPE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={cx("rounded px-1 py-1 text-[11px] capitalize", type === t ? "bg-accent/15 text-accent" : "text-muted hover:bg-border/50")}
          >
            {t === "stop-limit" ? "Stop-lmt" : t}
          </button>
        ))}
      </div>

      {(type === "limit" || type === "stop-limit") && (
        <label className="block text-xs">
          <span className="text-muted">Limit price</span>
          <input type="number" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={price != null ? formatPrice(price, digits) : undefined}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        </label>
      )}
      {(type === "stop" || type === "stop-limit") && (
        <label className="block text-xs">
          <span className="text-muted">Stop trigger</span>
          <input type="number" step="any" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} placeholder={price != null ? formatPrice(price, digits) : undefined}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        </label>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <label className="block text-xs">
          <span className="text-muted">Risk % {sizeMode === "risk" && "(auto qty)"}</span>
          <input type="number" min="0" step="any" value={riskPct}
            onChange={(e) => { setRiskPct(e.target.value); setSizeMode("risk"); }}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Qty (units) {sizeMode === "qty" && "(manual)"}</span>
          <input type="number" min="0" step="any" value={sizeMode === "risk" && computedQty != null && computedQty > 0 ? String(computedQty) : qty}
            onChange={(e) => { setQty(e.target.value); setSizeMode("qty"); }}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        </label>
      </div>
      <p className="font-mono text-xs tabular-nums text-muted">
        {Number.isFinite(notional)
          ? `Notional $${money(notional)} · margin $${money(reqMargin)} · fee $${money(Number.isFinite(openFee) ? openFee : 0)}`
          : "Enter risk % + stop, or a quantity"}
        {Number.isFinite(riskCash) ? ` · risk $${money(riskCash)}` : ""}
        {Number.isFinite(rr) ? ` · RR ${rr.toFixed(2)}` : ""}
      </p>

      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={useStop} onChange={(e) => setUseStop(e.target.checked)} />
          Stop-loss
        </label>
        {useStop && (
          <input type="number" step="any" placeholder="Stop price" value={stop} onChange={(e) => setStop(e.target.value)}
            className="w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={useTarget} onChange={(e) => setUseTarget(e.target.checked)} />
          Take-profit
        </label>
        {useTarget && (
          <input type="number" step="any" placeholder="Target price" value={target} onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={useTrail} onChange={(e) => setUseTrail(e.target.checked)} />
          Trailing stop
        </label>
        {useTrail && (
          <input type="number" step="any" placeholder="Trail distance (price units)" value={trail} onChange={(e) => setTrail(e.target.value)}
            className="w-full rounded border border-border bg-background px-1.5 py-1 text-right font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent" />
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={quickBracket} disabled={price == null && !Number.isFinite(entryRef)}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-border/50 hover:text-foreground disabled:opacity-50">
            Set ±1% bracket
          </button>
          {type !== "market" && (
            <label className="ml-auto flex items-center gap-1 text-xs text-muted">
              Expiry
              <select value={expiry} onChange={(e) => setExpiry(e.target.value as "GTC" | "IOC")}
                className="rounded border border-border bg-background px-1 py-0.5 text-xs">
                <option value="GTC">GTC</option>
                <option value="IOC">IOC</option>
              </select>
            </label>
          )}
        </div>
      </div>

      <button type="button" onClick={submit} disabled={price == null}
        className={cx("w-full rounded px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50", side === "long" ? "bg-up" : "bg-down")}>
        {type === "market" ? `Market ${side === "long" ? "Buy" : "Sell"}` : `${type} ${side}`} {symbol}
      </button>
      {error && (<p role="alert" className="text-xs text-down">{error}</p>)}
      <p className="text-xs text-muted">
        {type === "market" ? `Fills at touch incl. ~½ spread + fee (${(spec.commissionRate * 1e4).toFixed(1)} bps/side).` : "Rests until touch (buy-limit: low ≤ limit; sell-limit: high ≥ limit). IOC cancels if not marketable."}
      </p>
    </div>
  );
}
