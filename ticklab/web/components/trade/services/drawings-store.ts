/**
 * localStorage-backed drawing persistence. Exposed through `api.chartDrawings`
 * so the future backend replaces this file's body without touching UI code.
 * Key format (`oc_drawings_<SYMBOL>`) matches OpenCharts.
 */
import type { Symbol } from "../constants";
import type { DrawingLine } from "../drawings/constants";

function key(symbol: Symbol): string {
  return `oc_drawings_${symbol}`;
}

function read(symbol: Symbol): DrawingLine[] {
  try {
    const raw = window.localStorage.getItem(key(symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DrawingLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(symbol: Symbol, drawings: DrawingLine[]): void {
  try {
    window.localStorage.setItem(key(symbol), JSON.stringify(drawings));
  } catch {
    /* storage full or unavailable — drawings stay in memory */
  }
}

export const drawingsStore = {
  async list(symbol: Symbol): Promise<DrawingLine[]> {
    return read(symbol);
  },

  async save(symbol: Symbol, drawing: DrawingLine): Promise<void> {
    const all = read(symbol);
    const i = all.findIndex((d) => d.id === drawing.id);
    if (i >= 0) all[i] = drawing;
    else all.push(drawing);
    write(symbol, all);
  },

  async remove(symbol: Symbol, id: string): Promise<void> {
    write(
      symbol,
      read(symbol).filter((d) => d.id !== id),
    );
  },

  async clear(symbol: Symbol): Promise<void> {
    write(symbol, []);
  },
};
