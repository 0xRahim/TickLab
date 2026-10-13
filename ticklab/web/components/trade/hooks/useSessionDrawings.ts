"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Symbol } from "../constants";
import type { DrawingLine } from "../drawings/constants";
import { sessionDrawingsStore } from "../services/session-drawings";

type HistoryOp =
  | { kind: "add"; drawing: DrawingLine }
  | { kind: "update"; before: DrawingLine; after: DrawingLine }
  | { kind: "remove"; drawing: DrawingLine }
  | { kind: "clear"; drawings: DrawingLine[] };

const HISTORY_LIMIT = 100;

function sortByZ(list: DrawingLine[]): DrawingLine[] {
  return [...list].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

/**
 * Session-scoped drawings: same undo/redo behavior as `useChartDrawings`
 * (Tradeye), persisted per (session, symbol) in SQLite. Shared across
 * timeframes within the session.
 */
export function useSessionDrawings(sessionId: string, symbol: Symbol) {
  const [drawings, setDrawings] = useState<DrawingLine[]>([]);
  const ref = useRef<{ sessionId: string; symbol: Symbol }>({ sessionId, symbol });
  const drawingsRef = useRef<DrawingLine[]>([]);
  const undoStackRef = useRef<HistoryOp[]>([]);
  const redoStackRef = useRef<HistoryOp[]>([]);

  const [active, setActive] = useState({ sessionId, symbol });
  if (active.sessionId !== sessionId || active.symbol !== symbol) {
    setActive({ sessionId, symbol });
    setDrawings([]);
  }

  useEffect(() => {
    let cancelled = false;
    ref.current = { sessionId, symbol };
    drawingsRef.current = [];
    undoStackRef.current = [];
    redoStackRef.current = [];
    sessionDrawingsStore
      .list(sessionId, symbol)
      .then((data) => {
        if (cancelled) return;
        const sorted = sortByZ(data ?? []);
        setDrawings(sorted);
        drawingsRef.current = sorted;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, symbol]);

  const applyAdd = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ([...drawingsRef.current, d]);
    setDrawings(drawingsRef.current);
    const { sessionId: sid, symbol: sym } = ref.current;
    sessionDrawingsStore.save(sid, sym, d).catch(() => {});
  }, []);

  const applyUpdate = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ(drawingsRef.current.map((x) => (x.id === d.id ? d : x)));
    setDrawings(drawingsRef.current);
    const { sessionId: sid, symbol: sym } = ref.current;
    sessionDrawingsStore.save(sid, sym, d).catch(() => {});
  }, []);

  const applyRemove = useCallback((id: string) => {
    drawingsRef.current = drawingsRef.current.filter((x) => x.id !== id);
    setDrawings(drawingsRef.current);
    const { sessionId: sid, symbol: sym } = ref.current;
    sessionDrawingsStore.remove(sid, sym, id).catch(() => {});
  }, []);

  const pushHistory = useCallback((op: HistoryOp) => {
    undoStackRef.current.push(op);
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const addDrawing = useCallback(
    (d: DrawingLine) => {
      pushHistory({ kind: "add", drawing: d });
      applyAdd(d);
    },
    [pushHistory, applyAdd],
  );

  const updateDrawing = useCallback(
    (d: DrawingLine) => {
      const before = drawingsRef.current.find((x) => x.id === d.id);
      if (before) pushHistory({ kind: "update", before, after: d });
      applyUpdate(d);
    },
    [pushHistory, applyUpdate],
  );

  const removeDrawing = useCallback(
    (id: string) => {
      const drawing = drawingsRef.current.find((x) => x.id === id);
      if (drawing) pushHistory({ kind: "remove", drawing });
      applyRemove(id);
    },
    [pushHistory, applyRemove],
  );

  const revertOp = useCallback(
    (op: HistoryOp) => {
      if (op.kind === "add") applyRemove(op.drawing.id);
      else if (op.kind === "update") applyUpdate(op.before);
      else if (op.kind === "remove") applyAdd(op.drawing);
      else for (const d of op.drawings) applyAdd(d);
    },
    [applyAdd, applyUpdate, applyRemove],
  );

  const replayOp = useCallback(
    (op: HistoryOp) => {
      if (op.kind === "add") applyAdd(op.drawing);
      else if (op.kind === "update") applyUpdate(op.after);
      else if (op.kind === "remove") applyRemove(op.drawing.id);
      else for (const d of op.drawings) applyRemove(d.id);
    },
    [applyAdd, applyUpdate, applyRemove],
  );

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    revertOp(op);
    redoStackRef.current.push(op);
  }, [revertOp]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    replayOp(op);
    undoStackRef.current.push(op);
  }, [replayOp]);

  return { drawings, addDrawing, updateDrawing, removeDrawing, undo, redo };
}
