"use client";

// Per-type style defaults (inherited by new drawings) and named style
// templates. Persisted in localStorage; simplified from the OpenCharts
// version (no auth-scoped prefs — single local user for the stub).

import type { DrawingLine } from "./constants";

export type StylePatch = Partial<
  Pick<
    DrawingLine,
    | "color"
    | "width"
    | "lineStyle"
    | "fillColor"
    | "fillOpacity"
    | "arrowStart"
    | "arrowEnd"
    | "fontSize"
  >
>;

export interface DrawingTemplate {
  name: string;
  style: StylePatch;
}

export const DRAWING_STYLES_EVENT = "drawing-styles-updated";
const DEFAULTS_KEY = "tradeye_drawing_defaults";
const TEMPLATES_KEY = "tradeye_drawing_templates";

function parse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAWING_STYLES_EVENT));
}

/** Style-only fields of a drawing (drops anchors/visibility/alert state). */
export function pickStyle(d: DrawingLine): StylePatch {
  return {
    color: d.color,
    width: d.width,
    lineStyle: d.lineStyle,
    fillColor: d.fillColor,
    fillOpacity: d.fillOpacity,
    arrowStart: d.arrowStart,
    arrowEnd: d.arrowEnd,
    fontSize: d.fontSize,
  };
}

export function getStyleDefaults(): Record<string, StylePatch> {
  return parse(read(DEFAULTS_KEY), {});
}

export function setTypeDefault(type: string, d: DrawingLine): void {
  persist(DEFAULTS_KEY, { ...getStyleDefaults(), [type]: pickStyle(d) });
}

export function getTemplates(): DrawingTemplate[] {
  return parse(read(TEMPLATES_KEY), []);
}

export function saveTemplate(name: string, d: DrawingLine): void {
  const templates = getTemplates().filter((t) => t.name !== name);
  templates.push({ name, style: pickStyle(d) });
  persist(TEMPLATES_KEY, templates);
}
