/** Shared risk-sizing math: qty from equity risk %. */
import { roundQty } from "./instruments";

/** Qty such that |entry - stop| * qty = equity * riskPct / 100. Rounded to step. */
export function qtyFromRisk(
  symbol: string,
  equity: number,
  riskPct: number,
  entry: number,
  stop: number,
): number {
  if (!Number.isFinite(equity) || equity <= 0) return 0;
  if (!Number.isFinite(riskPct) || riskPct <= 0) return 0;
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return 0;
  const dist = Math.abs(entry - stop);
  if (dist <= 0) return 0;
  const riskAmt = (equity * riskPct) / 100;
  return roundQty(symbol, riskAmt / dist);
}

/** Cash risked for a given qty. */
export function riskAmount(entry: number, stop: number, qty: number): number {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(qty)) return NaN;
  return Math.abs(entry - stop) * qty;
}

/** Reward:risk ratio. NaN when risk leg is zero. */
export function rewardRisk(entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return NaN;
  return Math.abs(target - entry) / risk;
}
