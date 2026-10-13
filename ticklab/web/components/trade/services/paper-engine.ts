/**
 * Pro paper trading engine (frontend, per-session scoped).
 * Supports market / limit / stop / stop-limit + attached SL/TP (OCO) +
 * trailing stops, partial closes, commission + spread/slippage, margin check
 * and liquidation. Fills evaluate on every mark() — live ticks and replay
 * bar ranges alike — so backtest chronology holds when callers pass bar time.
 *
 * Persistence is external: call snapshot()/hydrate() to sync with the
 * TickLab backend (trades+orders tables) or localStorage. State resets on
 * reload unless hydrated.
 */
import { create } from "zustand";
import { commissionFor, getInstrument, roundQty } from "../lib/instruments";

export type Side = "long" | "short";
export type CloseReason = "manual" | "stop" | "target" | "liquidated";
export type OrderType = "market" | "limit" | "stop" | "stop-limit";
export type OrderStatus = "pending" | "filled" | "cancelled" | "rejected";
export type Expiry = "GTC" | "IOC";

export const START_BALANCE = 100000;
export const LEVERAGE = 100;
/** Liquidate when margin level (equity/used*100) drops below this. */
export const LIQUIDATION_LEVEL = 100;

export interface Position {
  id: string;
  orderId?: string;
  sessionId?: string;
  drawingId?: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  stop?: number;
  target?: number;
  /** Trailing distance in price units (ratchets the stop). */
  trailDist?: number;
  /** Best favorable mark seen (for trailing). */
  trailPeak?: number;
  leverage: number;
  /** Accumulated commission paid open+close. */
  commission: number;
  riskPct?: number;
  openTime: number;
  mark: number;
}

export interface PendingOrder {
  id: string;
  sessionId?: string;
  drawingId?: string;
  symbol: string;
  side: Side;
  type: Exclude<OrderType, "market">;
  qty: number;
  /** Limit price (limit + stop-limit). */
  limitPrice?: number;
  /** Trigger price (stop + stop-limit). */
  stopPrice?: number;
  /** Armed stop-limit becomes a limit order once triggered. */
  armed?: boolean;
  stop?: number;
  target?: number;
  trailDist?: number;
  riskPct?: number;
  leverage: number;
  expiry: Expiry;
  status: OrderStatus;
  placedAt: number;
}

export interface FillRecord {
  id: string;
  time: number;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  kind: "open" | "close";
  pnl?: number;
  reason?: CloseReason;
  orderId?: string;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  commission: number;
  reason: CloseReason;
  openTime: number;
  closeTime: number;
}

export interface Quote {
  /** Reference price (tick or bar close) for MtM. */
  price: number;
  /** Bar range for trigger evaluation (ticks: high=low=price). */
  high: number;
  low: number;
  /** Optional bid/ask — when present, market fills use the touch side. */
  bid?: number;
  ask?: number;
  /** Bar/event time for fills (defaults to wall-clock for compat). */
  time?: number;
}

export interface OrderInput {
  stop?: number;
  target?: number;
  trailDist?: number;
  riskPct?: number;
  drawingId?: string;
  sessionId?: string;
  leverage?: number;
  /** Bar/event time for the fill record. */
  time?: number;
}

const dir = (side: Side): number => (side === "long" ? 1 : -1);

// Scratch buffer for pending fills collected during mark() iteration.
const pendingFills: Array<{ order: PendingOrder; price: number }> = [];

export function unrealized(p: Position, mark: number): number {
  return (mark - p.entry) * dir(p.side) * p.qty;
}

function notional(qty: number, mark: number): number {
  return Math.abs(mark * qty);
}

interface PaperState {
  balance: number;
  positions: Position[];
  orders: PendingOrder[];
  fills: FillRecord[];
  closed: ClosedTrade[];
  marks: Record<string, number>;
  equity: number;
  usedMargin: number;
  marginLevel: number | null;
  sessionScope: string | null;
  marketOrder: (
    symbol: string,
    side: Side,
    qty: number,
    quote: Quote,
    opts?: OrderInput,
  ) => { ok: boolean; error?: string; positionId?: string };
  placeOrder: (
    symbol: string,
    side: Side,
    type: OrderType,
    qty: number,
    quote: Quote,
    opts?: OrderInput & { limitPrice?: number; stopPrice?: number; expiry?: Expiry },
  ) => { ok: boolean; error?: string; orderId?: string; positionId?: string };
  cancelOrder: (id: string) => void;
  modifyOrder: (
    id: string,
    patch: { limitPrice?: number; stopPrice?: number; stop?: number; target?: number; qty?: number },
  ) => { ok: boolean; error?: string };
  modifyPosition: (
    id: string,
    patch: { stop?: number; target?: number; trailDist?: number },
  ) => { ok: boolean; error?: string };
  closePosition: (id: string, price: number, reason: CloseReason, qty?: number, time?: number) => void;
  reversePosition: (id: string, quote: Quote) => { ok: boolean; error?: string };
  closeAll: (marks: Record<string, number>, time?: number) => void;
  /** Mark-to-market + pending triggers + SL/TP/trail + liquidation. */
  mark: (symbol: string, quote: Quote) => void;
  setSessionScope: (id: string | null) => void;
  snapshot: () => { balance: number; positions: Position[]; orders: PendingOrder[]; fills: FillRecord[]; closed: ClosedTrade[] };
  hydrate: (snap: { balance: number; positions: Position[]; orders: PendingOrder[]; fills: FillRecord[]; closed: ClosedTrade[] }) => void;
  reset: () => void;
}

function recompute(
  balance: number,
  positions: Position[],
  marks: Record<string, number>,
): { equity: number; usedMargin: number; marginLevel: number | null } {
  let upnl = 0;
  let used = 0;
  for (const p of positions) {
    const m = marks[p.symbol] ?? p.mark;
    upnl += unrealized(p, m);
    used += notional(p.qty, m) / (p.leverage || LEVERAGE);
  }
  const equity = balance + upnl;
  return { equity, usedMargin: used, marginLevel: used > 0 ? (equity / used) * 100 : null };
}

function bracketOk(side: Side, ref: number, stop?: number, target?: number): boolean {
  if (stop != null && !(stop > 0)) return false;
  if (target != null && !(target > 0)) return false;
  if (stop != null && target != null) {
    if (side === "long") return stop < ref && target > ref;
    return stop > ref && target < ref;
  }
  if (stop != null) {
    if (side === "long") return stop < ref;
    return stop > ref;
  }
  if (target != null) {
    if (side === "long") return target > ref;
    return target < ref;
  }
  return true;
}

const nowSec = () => Math.floor(Date.now() / 1000);

function closeAt(
  p: Position,
  qty: number,
  price: number,
  reason: CloseReason,
  time: number,
): { trade: ClosedTrade; fill: FillRecord; remainder: Position | null } {
  const closeQty = Math.min(qty, p.qty);
  const pnlGross = (price - p.entry) * dir(p.side) * closeQty;
  const closeFee = commissionFor(p.symbol, price, closeQty);
  const pnl = pnlGross - closeFee;
  const remainder =
    closeQty < p.qty ? { ...p, qty: Number((p.qty - closeQty).toFixed(8)) } : null;
  return {
    trade: {
      id: closeQty < p.qty ? `${p.id}:p${time}` : p.id,
      symbol: p.symbol,
      side: p.side,
      qty: closeQty,
      entry: p.entry,
      exit: price,
      pnl,
      commission: p.commission + closeFee,
      reason,
      openTime: p.openTime,
      closeTime: time,
    },
    fill: {
      id: crypto.randomUUID(),
      time,
      symbol: p.symbol,
      side: p.side,
      qty: closeQty,
      price,
      kind: "close",
      pnl,
      reason,
    },
    remainder,
  };
}

/** Market touch price for a side: ask for buys, bid for sells, else mid±spread. */
function touchPrice(symbol: string, side: Side, quote: Quote): number {
  if (side === "long" && quote.ask != null && quote.ask > 0) return quote.ask;
  if (side === "short" && quote.bid != null && quote.bid > 0) return quote.bid;
  const half = getInstrument(symbol).spreadHalf;
  return quote.price + (side === "long" ? half : -half);
}

export const usePaper = create<PaperState>((set, get) => {
  function openPosition(
    s: { balance: number; positions: Position[]; fills: FillRecord[]; marks: Record<string, number> },
    args: {
      symbol: string;
      side: Side;
      qty: number;
      price: number;
      time: number;
      orderId?: string;
      input?: OrderInput;
    },
  ): { ok: boolean; error?: string; positionId?: string } {
    const { symbol, side, price } = args;
    const input = args.input ?? {};
    const qty = roundQty(symbol, args.qty);
    if (!(qty > 0)) {
      const spec = getInstrument(symbol);
      return { ok: false, error: `Qty below minimum (${spec.minQty}).` };
    }
    if (!(price > 0)) return { ok: false, error: "No price available." };
    const ref = price;
    if (!bracketOk(side, ref, input.stop, input.target))
      return { ok: false, error: "Stop/target must bracket the entry." };
    if (input.trailDist != null && !(input.trailDist > 0))
      return { ok: false, error: "Invalid trailing distance." };
    const leverage = input.leverage && input.leverage > 0 ? input.leverage : getInstrument(symbol).defaultLeverage;
    // Margin check against current free margin.
    const { equity, usedMargin } = recompute(s.balance, s.positions, s.marks);
    const free = equity - usedMargin;
    const required = notional(qty, price) / leverage;
    if (required > free) return { ok: false, error: "Insufficient margin." };
    const openFee = commissionFor(symbol, price, qty);
    const pos: Position = {
      id: crypto.randomUUID(),
      orderId: args.orderId,
      sessionId: input.sessionId ?? get().sessionScope ?? undefined,
      drawingId: input.drawingId,
      symbol,
      side,
      qty,
      entry: price,
      stop: input.stop,
      target: input.target,
      trailDist: input.trailDist,
      trailPeak: input.trailDist != null ? price : undefined,
      leverage,
      commission: openFee,
      riskPct: input.riskPct,
      openTime: input.time ?? args.time,
      mark: price,
    };
    const positions = [...s.positions, pos];
    const marks = { ...s.marks, [symbol]: price };
    const balance = s.balance - openFee;
    const fill: FillRecord = {
      id: crypto.randomUUID(),
      time: input.time ?? args.time,
      symbol,
      side,
      qty,
      price,
      kind: "open",
      orderId: args.orderId,
    };
    const r = recompute(balance, positions, marks);
    set({ positions, fills: [...get().fills, fill], marks, balance, ...r });
    return { ok: true, positionId: pos.id };
  }

  return {
    balance: START_BALANCE,
    positions: [],
    orders: [],
    fills: [],
    closed: [],
    marks: {},
    equity: START_BALANCE,
    usedMargin: 0,
    marginLevel: null,
    sessionScope: null,

    marketOrder: (symbol, side, qty, quote, opts) => {
      const t = opts?.time ?? quote.time ?? nowSec();
      const price = touchPrice(symbol, side, quote);
      return openPosition(
        { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
        { symbol, side, qty, price, time: t, input: opts },
      );
    },

    placeOrder: (symbol, side, type, qty, quote, opts = {}) => {
      const t = opts.time ?? quote.time ?? nowSec();
      if (type === "market") {
        const price = touchPrice(symbol, side, quote);
        return openPosition(
          { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
          { symbol, side, qty, price, time: t, input: opts },
        );
      }
      const q = roundQty(symbol, qty);
      if (!(q > 0)) {
        const spec = getInstrument(symbol);
        return { ok: false, error: `Qty below minimum (${spec.minQty}).` };
      }
      const { limitPrice, stopPrice, stop, target, trailDist } = opts;
      const ref = quote.price;
      if (!(ref > 0)) return { ok: false, error: "No price available." };
      if (type === "limit") {
        if (!(limitPrice != null && limitPrice > 0)) return { ok: false, error: "Limit price required." };
        if (!bracketOk(side, limitPrice, stop, target))
          return { ok: false, error: "Stop/target must bracket the limit price." };
        // Through-market limits fill immediately like a market order.
        const touched = side === "long" ? quote.low <= limitPrice! : quote.high >= limitPrice!;
        if (touched) {
          return openPosition(
            { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
            { symbol, side, qty: q, price: limitPrice!, time: t, input: opts },
          );
        }
      } else if (type === "stop") {
        if (!(stopPrice != null && stopPrice > 0)) return { ok: false, error: "Stop price required." };
        const touched = side === "long" ? quote.high >= stopPrice! : quote.low <= stopPrice!;
        if (touched) {
          const price = touchPrice(symbol, side, quote);
          return openPosition(
            { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
            { symbol, side, qty: q, price, time: t, input: opts },
          );
        }
        if (opts.expiry === "IOC") return { ok: false, error: "IOC stop not touched — cancelled." };
      } else {
        // stop-limit: needs both; trigger arms it, then limit logic applies.
        if (!(stopPrice != null && stopPrice > 0 && limitPrice != null && limitPrice > 0))
          return { ok: false, error: "Stop price + limit price required." };
        if (!bracketOk(side, limitPrice, stop, target))
          return { ok: false, error: "Stop/target must bracket the limit price." };
        const triggered = side === "long" ? quote.high >= stopPrice! : quote.low <= stopPrice!;
        if (triggered) {
          const touched = side === "long" ? quote.low <= limitPrice! : quote.high >= limitPrice!;
          if (touched) {
            return openPosition(
              { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
              { symbol, side, qty: q, price: limitPrice!, time: t, input: opts },
            );
          }
        }
        if (opts.expiry === "IOC") return { ok: false, error: "IOC stop-limit not marketable — cancelled." };
      }
      const order: PendingOrder = {
        id: crypto.randomUUID(),
        sessionId: opts.sessionId ?? get().sessionScope ?? undefined,
        drawingId: opts.drawingId,
        symbol,
        side,
        type,
        qty: q,
        limitPrice: opts.limitPrice,
        stopPrice: opts.stopPrice,
        armed: type === "stop-limit" ? side === "long" ? quote.high >= (opts.stopPrice ?? Infinity) : quote.low <= (opts.stopPrice ?? -Infinity) : undefined,
        stop,
        target,
        trailDist,
        riskPct: opts.riskPct,
        leverage: opts.leverage && opts.leverage > 0 ? opts.leverage : getInstrument(symbol).defaultLeverage,
        expiry: opts.expiry ?? "GTC",
        status: "pending",
        placedAt: t,
      };
      set({ orders: [...get().orders, order] });
      return { ok: true, orderId: order.id };
    },

    cancelOrder: (id) => {
      set({ orders: get().orders.filter((o) => o.id !== id) });
    },

    modifyOrder: (id, patch) => {
      const o = get().orders.find((x) => x.id === id);
      if (!o) return { ok: false, error: "Order not found." };
      const next = { ...o };
      if (patch.limitPrice !== undefined) {
        if (!(patch.limitPrice > 0)) return { ok: false, error: "Invalid limit price." };
        next.limitPrice = patch.limitPrice;
      }
      if (patch.stopPrice !== undefined) {
        if (!(patch.stopPrice > 0)) return { ok: false, error: "Invalid stop price." };
        next.stopPrice = patch.stopPrice;
      }
      if (patch.stop !== undefined) next.stop = patch.stop;
      if (patch.target !== undefined) next.target = patch.target;
      if (patch.qty !== undefined) {
        const q = roundQty(o.symbol, patch.qty);
        if (!(q > 0)) return { ok: false, error: "Qty below minimum." };
        next.qty = q;
      }
      const ref = next.limitPrice ?? o.limitPrice ?? null;
      if (ref != null && !bracketOk(o.side, ref, next.stop, next.target))
        return { ok: false, error: "Stop/target must bracket the limit price." };
      set({ orders: get().orders.map((x) => (x.id === id ? next : x)) });
      return { ok: true };
    },

    modifyPosition: (id, patch) => {
      const p = get().positions.find((x) => x.id === id);
      if (!p) return { ok: false, error: "Position not found." };
      const stop = patch.stop;
      const target = patch.target;
      if (stop !== undefined && stop !== null && !(stop > 0)) return { ok: false, error: "Invalid stop." };
      if (target !== undefined && target !== null && !(target > 0)) return { ok: false, error: "Invalid target." };
      if (!bracketOk(p.side, p.entry, stop, target))
        return { ok: false, error: "Stop/target must bracket the entry." };
      if (patch.trailDist !== undefined && patch.trailDist !== null && !(patch.trailDist > 0))
        return { ok: false, error: "Invalid trailing distance." };
      const positions = get().positions.map((x) =>
        x.id === id
          ? {
              ...x,
              stop,
              target,
              trailDist: patch.trailDist,
              trailPeak: patch.trailDist != null ? (x.trailPeak ?? x.entry) : undefined,
            }
          : x,
      );
      const r = recompute(get().balance, positions, get().marks);
      set({ positions, ...r });
      return { ok: true };
    },

    closePosition: (id, price, reason, qty, time) => {
      const p = get().positions.find((x) => x.id === id);
      if (!p) return;
      const t = time ?? nowSec();
      const { trade, fill, remainder } = closeAt(p, qty ?? p.qty, price, reason, t);
      const positions =
        remainder == null ? get().positions.filter((x) => x.id !== id) : get().positions.map((x) => (x.id === id ? remainder : x));
      const balance = get().balance + trade.pnl;
      const marks = { ...get().marks, [p.symbol]: price };
      const r = recompute(balance, positions, marks);
      set({ positions, balance, fills: [...get().fills, fill], closed: [...get().closed, trade], marks, ...r });
    },

    reversePosition: (id, quote) => {
      const p = get().positions.find((x) => x.id === id);
      if (!p) return { ok: false, error: "Position not found." };
      const t = quote.time ?? nowSec();
      const px = touchPrice(p.symbol, p.side === "long" ? "short" : "long", quote);
      // Close existing in full at the touch price, then open opposite for same qty.
      const { trade, fill } = closeAt(p, p.qty, p.side === "long" ? (quote.bid ?? px) : (quote.ask ?? px), "manual", t);
      const positions = get().positions.filter((x) => x.id !== id);
      const balance = get().balance + trade.pnl;
      const fills = [...get().fills, fill];
      const closed = [...get().closed, trade];
      const r0 = recompute(balance, positions, get().marks);
      set({ positions, balance, fills, closed, ...r0 });
      const side: Side = p.side === "long" ? "short" : "long";
      return openPosition(
        { balance: get().balance, positions: get().positions, fills: get().fills, marks: get().marks },
        { symbol: p.symbol, side, qty: p.qty, price: px, time: t, input: { stop: undefined, target: undefined } },
      );
    },

    closeAll: (marks, time) => {
      const t = time ?? nowSec();
      const trades: ClosedTrade[] = [];
      const fills: FillRecord[] = [];
      let balance = get().balance;
      for (const p of get().positions) {
        const price = marks[p.symbol] ?? p.mark;
        const { trade, fill } = closeAt(p, p.qty, price, "manual", t);
        trades.push(trade);
        fills.push(fill);
        balance += trade.pnl;
      }
      const merged = { ...get().marks, ...marks };
      const r = recompute(balance, [], merged);
      set({ positions: [], orders: [], balance, fills: [...get().fills, ...fills], closed: [...get().closed, ...trades], marks: merged, ...r });
    },

    mark: (symbol, quote) => {
      const t = quote.time ?? nowSec();
      const s = get();
      const prevMark = s.marks[symbol];
      const hasPos = s.positions.some((p) => p.symbol === symbol);
      const hasOrd = s.orders.some((o) => o.symbol === symbol && o.status === "pending");
      // Fast path: nothing to evaluate — skip set() entirely so subscribers
      // keep stable identities and can't feed a render loop.
      if (!hasPos && !hasOrd) {
        if (prevMark === quote.price) return;
        const nextMarks = { ...s.marks, [symbol]: quote.price };
        const r = recompute(s.balance, s.positions, nextMarks);
        set({ marks: nextMarks, ...r });
        return;
      }
      let { positions, balance, fills, closed } = s;
      const { orders } = s;
      const marks = prevMark === quote.price ? s.marks : { ...s.marks, [symbol]: quote.price };
      const marksChanged = marks !== s.marks;

      // 1. Pending triggers/fills (touch rule).
      const resting: PendingOrder[] = [];
      for (const o of orders) {
        if (o.symbol !== symbol || o.status !== "pending") {
          resting.push(o);
          continue;
        }
        if (o.type === "limit" && o.limitPrice != null) {
          const touched = o.side === "long" ? quote.low <= o.limitPrice : quote.high >= o.limitPrice;
          if (touched) {
            pendingFills.push({ order: o, price: o.limitPrice });
            continue;
          }
          resting.push(o);
        } else if (o.type === "stop" && o.stopPrice != null) {
          const touched = o.side === "long" ? quote.high >= o.stopPrice : quote.low <= o.stopPrice;
          if (touched) {
            pendingFills.push({ order: o, price: touchPrice(o.symbol, o.side, quote) });
            continue;
          }
          resting.push(o);
        } else if ((o.type as string) === "stop-limit" && o.stopPrice != null && o.limitPrice != null) {
          const triggered = o.armed || (o.side === "long" ? quote.high >= o.stopPrice : quote.low <= o.stopPrice);
          if (!triggered) {
            resting.push(o);
            continue;
          }
          const touched = o.side === "long" ? quote.low <= o.limitPrice : quote.high >= o.limitPrice;
          if (touched) {
            pendingFills.push({ order: o, price: o.limitPrice });
            continue;
          }
          resting.push({ ...o, armed: true });
        } else {
          resting.push(o);
        }
      }
      // Apply pending fills sequentially (updates store each time).
      let ordersChanged = resting.length !== orders.length;
      if (ordersChanged) set({ orders: resting });
      for (const f of pendingFills) {
        // Remove first, then open (openPosition reads current store).
        ordersChanged = true;
        set({ orders: get().orders.filter((x) => x.id !== f.order.id) });
        const cur = get();
        const res = openPosition(
          { balance: cur.balance, positions: cur.positions, fills: cur.fills, marks: { ...cur.marks, [symbol]: quote.price } },
          {
            symbol: f.order.symbol,
            side: f.order.side,
            qty: f.order.qty,
            price: f.price,
            time: t,
            orderId: f.order.id,
            input: {
              stop: f.order.stop,
              target: f.order.target,
              trailDist: f.order.trailDist,
              riskPct: f.order.riskPct,
              drawingId: f.order.drawingId,
              sessionId: f.order.sessionId,
              leverage: f.order.leverage,
              time: t,
            },
          },
        );
        if (!res.ok) {
          set({ orders: [...get().orders, { ...f.order, status: "rejected" as OrderStatus }] });
        }
      }
      pendingFills.length = 0;

      // Refresh after fills (any fill/reject already counts as a change).
      const fillsBefore = s.fills.length;
      const closedBefore = s.closed.length;
      const balanceBefore = s.balance;
      ({ positions, balance, fills, closed } = get());
      let changed =
        ordersChanged ||
        fills.length !== fillsBefore ||
        closed.length !== closedBefore ||
        balance !== balanceBefore;

      // 2. Trailing ratchet + SL/TP (stop-first on same bar).
      // Preserve position object identity when nothing changed so selectors
      // (positions arrays) stay referentially stable across no-op marks.
      const survivors: Position[] = [];
      let posChanged = false;
      for (const p of positions) {        if (p.symbol !== symbol) {
          survivors.push(p);
          continue;
        }
        let stop = p.stop;
        let peak = p.trailPeak;
        if (p.trailDist != null && p.trailDist > 0) {
          if (p.side === "long") {
            peak = Math.max(peak ?? p.entry, quote.high);
            const ratchet = peak - p.trailDist;
            stop = stop == null ? ratchet : Math.max(stop, ratchet);
          } else {
            peak = Math.min(peak ?? p.entry, quote.low);
            const ratchet = peak + p.trailDist;
            stop = stop == null ? ratchet : Math.min(stop, ratchet);
          }
        }
        const stopHit = stop != null && (p.side === "long" ? quote.low <= stop : quote.high >= stop);
        const targetHit = p.target != null && (p.side === "long" ? quote.high >= p.target : quote.low <= p.target);
        if (stopHit && stop != null) {
          const { trade, fill } = closeAt({ ...p, stop }, p.qty, stop, "stop", t);
          closed = [...closed, trade];
          fills = [...fills, fill];
          balance += trade.pnl;
          posChanged = true;
        } else if (targetHit && p.target != null) {
          const { trade, fill } = closeAt(p, p.qty, p.target, "target", t);
          closed = [...closed, trade];
          fills = [...fills, fill];
          balance += trade.pnl;
          posChanged = true;
        } else if (stop !== p.stop || peak !== p.trailPeak || quote.price !== p.mark) {
          survivors.push({ ...p, stop, trailPeak: peak, mark: quote.price });
          posChanged = true;
        } else {
          survivors.push(p);
        }
      }
      positions = survivors;
      changed = changed || posChanged;
      let r = recompute(balance, positions, marks);

      // 3. Liquidation: margin level < 100% → flatten at mark.
      if (r.marginLevel != null && r.marginLevel < LIQUIDATION_LEVEL && positions.length > 0) {
        for (const p of positions) {
          const px = marks[p.symbol] ?? p.mark;
          const { trade, fill } = closeAt(p, p.qty, px, "liquidated", t);
          closed = [...closed, trade];
          fills = [...fills, fill];
          balance += trade.pnl;
        }
        positions = [];
        changed = true;
        r = recompute(balance, positions, marks);
      }
      if (!changed && !marksChanged) return;
      // Reuse the previous positions array when every entry kept identity.
      const stablePositions =
        !posChanged && positions.length === s.positions.length ? s.positions : positions;
      set({ positions: stablePositions, balance, fills, closed, marks, ...r });
    },

    setSessionScope: (id) => set({ sessionScope: id }),

    snapshot: () => {
      const s = get();
      return { balance: s.balance, positions: s.positions, orders: s.orders, fills: s.fills, closed: s.closed };
    },

    hydrate: (snap) => {
      const r = recompute(snap.balance, snap.positions, get().marks);
      set({ balance: snap.balance, positions: snap.positions, orders: snap.orders, fills: snap.fills, closed: snap.closed, ...r });
    },

    reset: () =>
      set({
        balance: START_BALANCE,
        positions: [],
        orders: [],
        fills: [],
        closed: [],
        marks: {},
        equity: START_BALANCE,
        usedMargin: 0,
        marginLevel: null,
      }),
  };
});
