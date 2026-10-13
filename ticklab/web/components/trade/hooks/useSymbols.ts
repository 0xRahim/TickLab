"use client";

import { useEffect, useState } from "react";
import { SYMBOLS, type Symbol } from "../constants";
import { fetchSymbols } from "../services/market-api";

function isSymbol(v: string): v is Symbol {
  return (SYMBOLS as readonly string[]).includes(v);
}

/**
 * Symbol options for the terminal, driven by `GET /api/symbols` (static
 * fallback when the API is unreachable) so the dropdown only shows
 * available tickers.
 */
export function useSymbols(): Symbol[] {
  const [live, setLive] = useState<Symbol[] | null>(null);

  useEffect(() => {
    let on = true;
    fetchSymbols().then((symbols) => {
      if (on) setLive(symbols.filter(isSymbol));
    });
    return () => {
      on = false;
    };
  }, []);

  const list = (live ?? [...SYMBOLS]).filter(isSymbol);
  return list.length > 0 ? list : [...SYMBOLS];
}
