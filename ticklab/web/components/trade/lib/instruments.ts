/** Per-symbol trading specs: sizing, costs, leverage. Single source of truth. */

export interface InstrumentSpec {
  symbol: string;
  /** Minimum order qty in units. */
  minQty: number;
  /** Qty rounding step. */
  qtyStep: number;
  /** Default leverage for margin. */
  defaultLeverage: number;
  /** Commission rate on notional per side (e.g. 0.0002 = 2 bps). 0 = none. */
  commissionRate: number;
  /** Half-spread fallback in price units when feed is mid-only. */
  spreadHalf: number;
  /** Slippage in ticks applied against the taker on market fills. */
  slippageTicks: number;
  /** Tick size for price rounding. */
  tickSize: number;
}

const SPECS: Record<string, InstrumentSpec> = {
  EURUSD: { symbol: "EURUSD", minQty: 1000, qtyStep: 1000, defaultLeverage: 100, commissionRate: 0.00002, spreadHalf: 0.00002, slippageTicks: 0, tickSize: 0.00001 },
  GBPUSD: { symbol: "GBPUSD", minQty: 1000, qtyStep: 1000, defaultLeverage: 100, commissionRate: 0.00002, spreadHalf: 0.00002, slippageTicks: 0, tickSize: 0.00001 },
  USDCAD: { symbol: "USDCAD", minQty: 1000, qtyStep: 1000, defaultLeverage: 100, commissionRate: 0.00002, spreadHalf: 0.00002, slippageTicks: 0, tickSize: 0.00001 },
  XAUUSD: { symbol: "XAUUSD", minQty: 0.01, qtyStep: 0.01, defaultLeverage: 100, commissionRate: 0.00002, spreadHalf: 0.05, slippageTicks: 0, tickSize: 0.01 },
  BTCUSD: { symbol: "BTCUSD", minQty: 0.001, qtyStep: 0.001, defaultLeverage: 100, commissionRate: 0.0005, spreadHalf: 2.5, slippageTicks: 0, tickSize: 0.01 },
};

const FALLBACK: InstrumentSpec = {
  symbol: "*",
  minQty: 0.01,
  qtyStep: 0.01,
  defaultLeverage: 100,
  commissionRate: 0,
  spreadHalf: 0,
  slippageTicks: 0,
  tickSize: 0.00001,
};

export function getInstrument(symbol: string): InstrumentSpec {
  return SPECS[symbol] ?? { ...FALLBACK, symbol };
}

/** Round qty down to the instrument step, floored at minQty. Returns 0 if below min. */
export function roundQty(symbol: string, qty: number): number {
  const spec = getInstrument(symbol);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const steps = Math.floor(qty / spec.qtyStep + 1e-9);
  const rounded = steps * spec.qtyStep;
  // Avoid float dust (e.g. 0.30000000004).
  const fixed = Number(rounded.toFixed(8));
  return fixed >= spec.minQty ? fixed : 0;
}

/** Commission for one side of a fill. */
export function commissionFor(symbol: string, price: number, qty: number): number {
  const spec = getInstrument(symbol);
  if (!(price > 0) || !(qty > 0)) return 0;
  return Math.abs(price * qty) * spec.commissionRate;
}
