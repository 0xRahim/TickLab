/**
 * Client for the Tradeye price API (`/api/symbols`, `/api/quote`,
 * `/api/candles`). Base URL comes from `NEXT_PUBLIC_API_URL` (falls back to
 * the local API dev server). The sole market-data source for the terminal.
 */
import { SYMBOLS, type Symbol, type Timeframe } from "../constants";
import type { Candle } from "./types";

function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || "http://127.0.0.1:4578";
}

function isSymbol(v: unknown): v is Symbol {
  return (
    typeof v === "string" &&
    (SYMBOLS as readonly string[]).includes(v.toUpperCase())
  );
}

async function getJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`);
  } catch {
    throw new Error("Cannot reach price service. Check your connection.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Price request failed.";
    throw new Error(msg);
  }
  return body;
}

/** Tickers available. Falls back to the static list when offline. */
export async function fetchSymbols(): Promise<Symbol[]> {
  try {
    const body = (await getJson("/api/symbols")) as {
      symbols?: Array<{ symbol?: unknown } | string>;
    };
    const raw = Array.isArray(body.symbols) ? body.symbols : [];
    const out: Symbol[] = [];
    for (const entry of raw) {
      const name = typeof entry === "string" ? entry : entry.symbol;
      if (isSymbol(name) && !out.includes(name.toUpperCase() as Symbol)) {
        out.push(name.toUpperCase() as Symbol);
      }
    }
    return out.length > 0 ? out : [...SYMBOLS];
  } catch {
    return [...SYMBOLS];
  }
}

export interface LiveQuote {
  price: number;
  time: number;
}

export async function fetchQuote(symbol: Symbol): Promise<LiveQuote> {
  const body = (await getJson(`/api/quote?symbol=${symbol}`)) as {
    price?: unknown;
    time?: unknown;
  };
  if (
    typeof body.price !== "number" ||
    !Number.isFinite(body.price) ||
    typeof body.time !== "number" ||
    !Number.isFinite(body.time)
  ) {
    throw new Error("Price feed returned invalid data.");
  }
  return { price: body.price, time: body.time };
}

interface RawCandle {
  time?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

function toCandle(b: RawCandle): Candle | null {
  if (
    typeof b.time !== "number" ||
    !Number.isFinite(b.time) ||
    typeof b.open !== "number" ||
    !Number.isFinite(b.open) ||
    typeof b.high !== "number" ||
    !Number.isFinite(b.high) ||
    typeof b.low !== "number" ||
    !Number.isFinite(b.low) ||
    typeof b.close !== "number" ||
    !Number.isFinite(b.close)
  ) {
    return null;
  }
  return {
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: typeof b.volume === "number" && Number.isFinite(b.volume) ? b.volume : 0,
  };
}

/** History for chart + backtesting. `limit` bars ending at now (default 1000). */
export async function fetchCandles(
  symbol: Symbol,
  interval: Timeframe,
  opts?: { limit?: number; from?: string; to?: string },
): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol, interval });
  if (opts?.from && opts?.to) {
    params.set("from", opts.from);
    params.set("to", opts.to);
  } else {
    params.set("limit", String(opts?.limit ?? 1000));
  }
  const body = (await getJson(`/api/candles?${params.toString()}`)) as {
    candles?: unknown;
  };
  if (!Array.isArray(body.candles)) throw new Error("Price feed returned invalid data.");
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const raw of body.candles as RawCandle[]) {
    const c = toCandle(raw);
    if (!c || seen.has(c.time)) continue;
    seen.add(c.time);
    out.push(c);
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
