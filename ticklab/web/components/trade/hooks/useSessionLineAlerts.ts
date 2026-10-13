"use client";

import { useEffect, useRef, useState } from "react";
import type { DrawingLine } from "../drawings/constants";
import { detectCrossings, playAlertBeep } from "../lib/chart-plugins/drawing-tools/line-alerts";

export interface SessionLineAlert {
  id: string;
  message: string;
}

/**
 * Offline line-cross alerts: evaluates alert-enabled drawings against the
 * replay-revealed price (bar close per step) instead of the live tick
 * stream. No network.
 */
export function useSessionLineAlerts(price: number | null, drawings: DrawingLine[]): SessionLineAlert | null {
  const [alert, setAlert] = useState<SessionLineAlert | null>(null);
  const prevRef = useRef<number | null>(null);
  const firedAt = useRef(new Map<string, number>());

  // Render-time reset when the drawing set identity changes
  // (derived-state pattern) — keeps setState out of effects for lint.
  const [knownDrawings, setKnownDrawings] = useState(drawings);
  if (knownDrawings !== drawings) {
    setKnownDrawings(drawings);
    setAlert(null);
  }

  useEffect(() => {
    prevRef.current = null;
    firedAt.current = new Map();
  }, [drawings]);

  useEffect(() => {
    if (price == null) return;
    const prev = prevRef.current;
    prevRef.current = price;
    if (prev === null || prev === price) return;
    const crossed = detectCrossings(drawings, prev, price, Math.floor(Date.now() / 1000), firedAt.current);
    if (crossed.length > 0) {
      playAlertBeep();
      const d = crossed[0]!;
      setAlert({
        id: `${d.id}:${price}`,
        message: d.alertMessage || `Price crossed ${d.type} ${d.price}`,
      });
    }
  }, [price, drawings]);

  useEffect(() => {
    if (!alert) return;
    const t = window.setTimeout(() => setAlert(null), 5000);
    return () => window.clearTimeout(t);
  }, [alert]);

  return alert;
}
