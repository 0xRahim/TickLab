"use client";

import { useEffect, useRef, useState } from "react";
import type { Symbol } from "../constants";
import type { DrawingLine } from "../drawings/constants";
import { detectCrossings, playAlertBeep } from "../lib/chart-plugins/drawing-tools/line-alerts";
import { ws } from "../services/ws";

export interface LineAlert {
  id: string;
  message: string;
}

/**
 * In-session line-cross alerts: watches alert-enabled drawings against the
 * live tick stream, beeps + raises a toast on cross. Resets per symbol.
 */
export function useLineAlerts(symbol: Symbol, drawings: DrawingLine[]): LineAlert | null {
  const [alert, setAlert] = useState<LineAlert | null>(null);
  const prevRef = useRef<number | null>(null);
  const firedAt = useRef(new Map<string, number>());
  const streamRef = useRef(symbol);

  // Render-time reset on symbol change (derived-state pattern).
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  if (activeSymbol !== symbol) {
    setActiveSymbol(symbol);
    setAlert(null);
  }

  useEffect(() => {
    if (streamRef.current !== symbol) {
      streamRef.current = symbol;
      prevRef.current = null;
      firedAt.current = new Map();
    }
    return ws.subscribe(symbol, (tick) => {
      const prev = prevRef.current;
      prevRef.current = tick.price;
      if (prev === null || prev === tick.price) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const crossed = detectCrossings(drawings, prev, tick.price, nowSec, firedAt.current);
      if (crossed.length > 0) {
        playAlertBeep();
        const d = crossed[0]!;
        setAlert({
          id: `${d.id}:${nowSec}`,
          message: d.alertMessage || `Price crossed ${d.type} ${d.price}`,
        });
      }
    });
  }, [symbol, drawings]);

  useEffect(() => {
    if (!alert) return;
    const t = window.setTimeout(() => setAlert(null), 5000);
    return () => window.clearTimeout(t);
  }, [alert]);

  return alert;
}
