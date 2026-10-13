"use client";

import type { Symbol } from "../constants";
import type { DrawingLine } from "../drawings/constants";

function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || "http://127.0.0.1:4578";
}

function localKey(sessionId: string, symbol: Symbol): string {
  return `ticklab_drawings_${sessionId}_${symbol}`;
}

function readLocal(sessionId: string, symbol: Symbol): DrawingLine[] {
  try {
    const raw = window.localStorage.getItem(localKey(sessionId, symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DrawingLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(sessionId: string, symbol: Symbol, drawings: DrawingLine[]): void {
  try {
    window.localStorage.setItem(localKey(sessionId, symbol), JSON.stringify(drawings));
  } catch {
    /* storage unavailable — SQLite copy is authoritative */
  }
}

/**
 * Session-scoped drawing persistence: SQLite (authoritative) with
 * localStorage mirror for instant loads. Same list/save/remove/clear shape
 * as `drawingsStore` so hooks stay identical.
 */
export const sessionDrawingsStore = {
  async list(sessionId: string, symbol: Symbol): Promise<DrawingLine[]> {
    try {
      const res = await fetch(`${baseUrl()}/api/sessions/${sessionId}/drawings?symbol=${symbol}`);
      if (res.ok) {
        const body = (await res.json()) as { drawings?: DrawingLine[] };
        const drawings = Array.isArray(body.drawings) ? body.drawings : [];
        writeLocal(sessionId, symbol, drawings);
        return drawings;
      }
    } catch {
      /* backend unreachable — fall back to the local mirror */
    }
    return readLocal(sessionId, symbol);
  },

  async save(sessionId: string, symbol: Symbol, drawing: DrawingLine): Promise<void> {
    const all = readLocal(sessionId, symbol);
    const i = all.findIndex((d) => d.id === drawing.id);
    if (i >= 0) all[i] = drawing;
    else all.push(drawing);
    writeLocal(sessionId, symbol, all);
    try {
      await fetch(`${baseUrl()}/api/sessions/${sessionId}/drawings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, drawings: all }),
      });
    } catch {
      /* offline — local mirror + in-memory state keep working */
    }
  },

  async remove(sessionId: string, symbol: Symbol, id: string): Promise<void> {
    const all = readLocal(sessionId, symbol).filter((d) => d.id !== id);
    writeLocal(sessionId, symbol, all);
    try {
      await fetch(`${baseUrl()}/api/sessions/${sessionId}/drawings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, drawings: all }),
      });
    } catch {
      /* offline — local mirror keeps working */
    }
  },

  async clear(sessionId: string, symbol: Symbol): Promise<void> {
    writeLocal(sessionId, symbol, []);
    try {
      await fetch(`${baseUrl()}/api/sessions/${sessionId}/drawings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, drawings: [] }),
      });
    } catch {
      /* offline */
    }
  },
};
