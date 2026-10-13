/** Shared dashboard number/date formatters. */

export function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

export function fmtSigned(n: number): string {
  if (n > 0) return `+$${Math.round(n).toLocaleString("en-US")}`;
  if (n < 0) return `-$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return "$0";
}

export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function fmtBars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function fmtDay(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}
