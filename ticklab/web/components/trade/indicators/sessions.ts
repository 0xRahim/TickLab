/**
 * Session Markers — pure session-window math (no chart calls, no React).
 *
 * Sessions are defined as UK wall-clock (Europe/London) HH:MM ranges so the
 * defaults read naturally for a UK trader: Asia overnight, the London open's
 * first hour, and New York's second hour. DST is handled via Intl lookups —
 * day boundaries and window edges are resolved in Europe/London wall time,
 * so 23/25-hour DST days just work.
 *
 * The chart primitive consumes `SessionWindow[]` (data-space only); all
 * time→pixel / price→pixel conversion happens inside the render pass.
 */
import type { Candle } from "../services/types";

export type SessionId = "asia" | "london" | "newyork";

export type SessionBorderStyle = "solid" | "dashed" | "dotted";

export interface SessionDef {
  id: SessionId;
  label: string;
  enabled: boolean;
  /** HH:MM in Europe/London wall time. */
  start: string;
  /** HH:MM in Europe/London wall time. end <= start means past midnight. */
  end: string;
  fillColor: string;
  /** 0–1 */
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: SessionBorderStyle;
}

export interface SessionMarkerSettings {
  /** Master switch for the indicator. */
  enabled: boolean;
  showLabels: boolean;
  sessions: SessionDef[];
}

export const SESSION_TIMEZONE = "Europe/London";

export const DEFAULT_SESSION_SETTINGS: SessionMarkerSettings = {
  enabled: true,
  showLabels: true,
  sessions: [
    {
      id: "asia",
      label: "Asia",
      enabled: true,
      start: "00:00",
      end: "06:00",
      fillColor: "#2196F3",
      fillOpacity: 0.08,
      borderColor: "#2196F3",
      borderWidth: 1,
      borderStyle: "solid",
    },
    {
      id: "london",
      label: "London",
      enabled: true,
      start: "08:00",
      end: "09:00",
      fillColor: "#ff9800",
      fillOpacity: 0.1,
      borderColor: "#ff9800",
      borderWidth: 1,
      borderStyle: "solid",
    },
    {
      id: "newyork",
      label: "New York",
      enabled: true,
      start: "14:30",
      end: "15:30",
      fillColor: "#9c27b0",
      fillOpacity: 0.1,
      borderColor: "#9c27b0",
      borderWidth: 1,
      borderStyle: "solid",
    },
  ],
};

/** One rendered box: the candles in [startTime, endTime) span [low, high]. */
export interface SessionWindow {
  sessionId: SessionId;
  label: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  fillColor: string;
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: SessionBorderStyle;
}

export function parseHHMM(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export function isValidHHMM(v: string): boolean {
  return parseHHMM(v) !== null;
}

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SESSION_TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

interface LondonParts {
  year: number;
  month: number;
  day: number;
  minutesOfDay: number;
}

function londonParts(timeSec: number): LondonParts {
  const fields: Record<string, number> = {};
  for (const part of londonFormatter.formatToParts(new Date(timeSec * 1000))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 1970,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    minutesOfDay: (fields.hour ?? 0) * 60 + (fields.minute ?? 0),
  };
}

/**
 * Convert a Europe/London wall time to unix seconds. Two fixed-point
 * iterations converge across DST transitions for our purposes.
 */
export function londonWallToUnix(
  year: number,
  month: number,
  day: number,
  h: number,
  min: number,
): number {
  const guess = Date.UTC(year, month - 1, day, h, min) / 1000;
  // offsetAt(guess) = LondonWall(guess) - guess → utc = guess - offset
  const off1 = wallMinusActual(guess);
  const once = guess - off1;
  const off2 = wallMinusActual(once);
  return guess - off2;
}

/**
 * LondonWall(t) - t, in seconds (0 in winter/GMT, +3600 in summer/BST).
 * The London wall reading reinterpreted as UTC is exactly t + offset, so
 * the difference is the offset. Normalized defensively (mod day).
 */
function wallMinusActual(t: number): number {
  const p = londonParts(t);
  const wallAsUTC = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutesOfDay) / 1000;
  let off = (wallAsUTC - t) % 86400;
  if (off < 0) off += 86400;
  if (off > 86400 - 3600) off -= 86400;
  return off;
}

/**
 * Compute one box per UK day per enabled session, fitted to the candles in
 * the window. Candles must be ascending by time. Windows with no candles
 * are skipped (no box to fit).
 */
export function getSessionWindows(
  candles: Candle[],
  settings: SessionMarkerSettings,
): SessionWindow[] {
  if (candles.length === 0) return [];
  const active = settings.sessions.filter((s) => s.enabled);
  if (active.length === 0) return [];

  const parsed = active
    .map((s) => {
      const st = parseHHMM(s.start);
      const en = parseHHMM(s.end);
      if (!st || !en) return null;
      return { def: s, st, en };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (parsed.length === 0) return [];

  const first = candles[0]!.time;
  const last = candles[candles.length - 1]!.time;

  // Walk UK calendar days covering the data.
  const startParts = londonParts(first);
  let dayStart = londonWallToUnix(startParts.year, startParts.month, startParts.day, 0, 0);
  // Guard: wallToUnix(00:00) can land after `first` on DST spring-forward.
  if (dayStart > first) dayStart -= 86400;

  const windows: SessionWindow[] = [];
  for (let d = 0; d < 4000; d++) {
    if (dayStart > last) break;
    const dp = londonParts(dayStart + 3600); // safely inside the day
    for (const { def, st, en } of parsed) {
      const ws = londonWallToUnix(dp.year, dp.month, dp.day, st.h, st.m);
      const we0 = londonWallToUnix(dp.year, dp.month, dp.day, en.h, en.m);
      const we = we0 <= ws ? we0 + 86400 : we0; // overnight session
      if (we <= first || ws > last) continue;
      const lo = lowerBound(candles, Math.max(ws, first));
      const hi = upperBound(candles, Math.min(we, last + 1));
      if (hi <= lo) continue;
      let high = -Infinity;
      let low = Infinity;
      for (let i = lo; i < hi; i++) {
        const c = candles[i]!;
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
      }
      windows.push({
        sessionId: def.id,
        label: def.label,
        startTime: ws,
        endTime: we,
        high,
        low,
        fillColor: def.fillColor,
        fillOpacity: def.fillOpacity,
        borderColor: def.borderColor,
        borderWidth: def.borderWidth,
        borderStyle: def.borderStyle,
      });
    }
    // Next UK midnight.
    const next = londonParts(dayStart + 86400 + 3600);
    const nextStart = londonWallToUnix(next.year, next.month, next.day, 0, 0);
    dayStart = nextStart > dayStart ? nextStart : dayStart + 86400;
  }
  return windows;
}

function lowerBound(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Merge persisted JSON over defaults (bad values fall back). */
export function normalizeSettings(raw: unknown): SessionMarkerSettings {
  const fallback = structuredClone(DEFAULT_SESSION_SETTINGS);
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const byId = new Map(fallback.sessions.map((s) => [s.id, s]));
  if (Array.isArray(r.sessions)) {
    for (const item of r.sessions) {
      if (typeof item !== "object" || item === null) continue;
      const s = item as Record<string, unknown>;
      const cur = byId.get(s.id as SessionId);
      if (!cur) continue;
      if (typeof s.enabled === "boolean") cur.enabled = s.enabled;
      if (typeof s.start === "string" && isValidHHMM(s.start)) cur.start = s.start.trim();
      if (typeof s.end === "string" && isValidHHMM(s.end)) cur.end = s.end.trim();
      if (typeof s.label === "string" && s.label.trim()) cur.label = s.label.trim().slice(0, 24);
      if (typeof s.fillColor === "string" && isHexColor(s.fillColor)) cur.fillColor = s.fillColor;
      if (typeof s.borderColor === "string" && isHexColor(s.borderColor))
        cur.borderColor = s.borderColor;
      if (typeof s.fillOpacity === "number" && s.fillOpacity >= 0 && s.fillOpacity <= 1)
        cur.fillOpacity = s.fillOpacity;
      if (typeof s.borderWidth === "number" && s.borderWidth >= 0 && s.borderWidth <= 5)
        cur.borderWidth = Math.round(s.borderWidth);
      if (s.borderStyle === "solid" || s.borderStyle === "dashed" || s.borderStyle === "dotted")
        cur.borderStyle = s.borderStyle;
    }
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
    showLabels: typeof r.showLabels === "boolean" ? r.showLabels : fallback.showLabels,
    sessions: fallback.sessions,
  };
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}
