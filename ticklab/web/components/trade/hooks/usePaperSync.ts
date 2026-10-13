"use client";

import { useEffect, useRef } from "react";
import { usePaper } from "../services/paper-engine";
import {
  deleteSessionOrder,
  fetchSessionOrders,
  fetchSessionTrades,
  patchSessionOrder,
  persistOrder,
  persistTrade,
} from "../services/session-api";

/**
 * Per-session persistence for the paper engine.
 * - Hydrates positions/orders/history from the backend on session switch,
 *   falling back to localStorage when offline.
 * - Mirrors fills/closes + working orders back (debounced, best-effort).
 */
export function usePaperSync(sessionId: string | null) {
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate on session switch. No mounted-ref guard here: under StrictMode
  // effects run setup → cleanup → setup with refs preserved, so an
  // early-return guard would skip hydration forever. The `cancelled` flag
  // already discards the stale first run.
  useEffect(() => {
    if (!sessionId) return;
    const st = usePaper.getState();
    st.setSessionScope(sessionId);
    let cancelled = false;
    (async () => {
      try {
        const [trades, orders] = await Promise.all([
          fetchSessionTrades(sessionId),
          fetchSessionOrders(sessionId, "all"),
        ]);
        if (cancelled) return;
        const hasRemote = trades.length > 0 || orders.length > 0;
        if (hasRemote) {
          const positions = trades
            .filter((t) => t.exit == null || t.status === "open")
            .map((t) => ({
              id: t.id,
              sessionId,
              symbol: t.symbol,
              side: (t.side === "short" ? "short" : "long") as "long" | "short",
              qty: t.qty,
              entry: t.entry,
              stop: t.sl ?? undefined,
              target: t.tp ?? undefined,
              leverage: t.leverage ?? 100,
              commission: t.commission ?? 0,
              openTime: t.opened_at,
              mark: t.entry,
            }));
          const pending = orders
            .filter((o) => o.status === "pending")
            .map((o) => ({
              id: o.id,
              sessionId,
              drawingId: o.drawing_id ?? undefined,
              symbol: o.symbol,
              side: (o.side === "short" ? "short" : "long") as "long" | "short",
              type: (o.type === "stop" || o.type === "stop-limit" ? o.type : "limit") as "limit" | "stop" | "stop-limit",
              qty: o.qty,
              limitPrice: o.limit_price ?? undefined,
              stopPrice: o.stop_price ?? undefined,
              stop: o.sl ?? undefined,
              target: o.tp ?? undefined,
              trailDist: o.trail_dist ?? undefined,
              riskPct: o.risk_pct ?? undefined,
              leverage: o.leverage ?? 100,
              expiry: (o.expiry === "IOC" ? "IOC" : "GTC") as "GTC" | "IOC",
              status: "pending" as const,
              placedAt: o.placed_at,
            }));
          const closed = trades
            .filter((t) => t.exit != null)
            .map((t) => ({
              id: t.id,
              symbol: t.symbol,
              side: (t.side === "short" ? "short" : "long") as "long" | "short",
              qty: t.qty,
              entry: t.entry,
              exit: t.exit ?? t.entry,
              pnl: t.pnl ?? 0,
              commission: t.commission ?? 0,
              reason: (t.reason === "stop" || t.reason === "target" || t.reason === "liquidated" ? t.reason : "manual") as "manual" | "stop" | "target" | "liquidated",
              openTime: t.opened_at,
              closeTime: t.closed_at ?? t.opened_at,
            }));
          // Balance: start + realized pnl.
          const realized = closed.reduce((a, c) => a + c.pnl, 0);
          const { START_BALANCE } = await import("../services/paper-engine");
          usePaper.getState().hydrate({
            balance: START_BALANCE + realized,
            positions,
            orders: pending,
            fills: [],
            closed,
          });
          return;
        }
      } catch {
        // Fall through to localStorage.
      }
      try {
        const raw = localStorage.getItem(`ticklab_paper_${sessionId}`);
        if (raw) {
          const snap = JSON.parse(raw) as Parameters<typeof st.hydrate>[0];
          if (snap && Array.isArray(snap.positions)) st.hydrate(snap);
          else st.reset();
        } else {
          st.reset();
        }
      } catch {
        st.reset();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Mirror to backend + localStorage on fills/positions/orders/closed change.
  const fillsLen = usePaper((s) => s.fills.length);
  const closedLen = usePaper((s) => s.closed.length);
  const ordersLen = usePaper((s) => s.orders.length);
  const positionsLen = usePaper((s) => s.positions.length);
  useEffect(() => {
    if (!sessionId) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const s = usePaper.getState();
      try {
        localStorage.setItem(`ticklab_paper_${sessionId}`, JSON.stringify(s.snapshot()));
      } catch {
        // Quota/SSR — ignore.
      }
      // Persist open positions as open trades.
      for (const p of s.positions) {
        void persistTrade(sessionId, {
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          qty: p.qty,
          entry: p.entry,
          sl: p.stop ?? null,
          tp: p.target ?? null,
          opened_at: p.openTime,
          commission: p.commission,
          leverage: p.leverage,
          status: "open",
          order_type: "market",
        });
      }
      for (const t of s.closed.slice(-25)) {
        void persistTrade(sessionId, {
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          qty: t.qty,
          entry: t.entry,
          exit: t.exit,
          opened_at: t.openTime,
          closed_at: t.closeTime,
          pnl: t.pnl,
          reason: t.reason,
          commission: t.commission,
          status: "closed",
          order_type: "market",
        });
      }
      for (const o of s.orders) {
        void persistOrder(sessionId, {
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          qty: o.qty,
          limit_price: o.limitPrice ?? null,
          stop_price: o.stopPrice ?? null,
          sl: o.stop ?? null,
          tp: o.target ?? null,
          trail_dist: o.trailDist ?? null,
          risk_pct: o.riskPct ?? null,
          leverage: o.leverage,
          expiry: o.expiry,
          status: o.status,
          drawing_id: o.drawingId ?? null,
          placed_at: o.placedAt,
        });
      }
    }, 600);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [sessionId, fillsLen, closedLen, ordersLen, positionsLen]);

  // Cancel sync helper re-export (UI calls engine first, sync follows).
  return { persistOrder, patchSessionOrder, deleteSessionOrder };
}
