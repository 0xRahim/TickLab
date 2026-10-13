/**
 * Session Markers settings — global (all symbols), persisted to localStorage.
 * Loaded through `normalizeSettings` so corrupt/partial JSON falls back to
 * defaults field-by-field instead of resetting everything.
 */
"use client";

import { create } from "zustand";
import {
  DEFAULT_SESSION_SETTINGS,
  isValidHHMM,
  normalizeSettings,
  type SessionBorderStyle,
  type SessionId,
  type SessionMarkerSettings,
} from "./sessions";

const STORAGE_KEY = "oc_session_markers_v1";

function load(): SessionMarkerSettings {
  const fallback = structuredClone(DEFAULT_SESSION_SETTINGS);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

function persist(s: SessionMarkerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage full/blocked — settings still apply for this session.
  }
}

interface SessionSettingsState extends SessionMarkerSettings {
  setEnabled: (enabled: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setSessionEnabled: (id: SessionId, enabled: boolean) => void;
  updateSession: (
    id: SessionId,
    patch: {
      start?: string;
      end?: string;
      fillColor?: string;
      fillOpacity?: number;
      borderColor?: string;
      borderWidth?: number;
      borderStyle?: SessionBorderStyle;
    },
  ) => void;
  resetDefaults: () => void;
}

function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export const useSessionSettings = create<SessionSettingsState>()((set) => {
  const initial = load();
  const apply = (next: SessionMarkerSettings) => {
    persist(next);
    set(next);
  };
  return {
    ...initial,
    setEnabled: (enabled) => {
      const s = { ...useSessionSettings.getState(), enabled };
      apply(settingsOf(s));
    },
    setShowLabels: (show) => {
      const s = { ...useSessionSettings.getState(), showLabels: show };
      apply(settingsOf(s));
    },
    setSessionEnabled: (id, enabled) => {
      const cur = useSessionSettings.getState();
      apply({
        ...settingsOf(cur),
        sessions: cur.sessions.map((x) => (x.id === id ? { ...x, enabled } : x)),
      });
    },
    updateSession: (id, patch) => {
      const cur = useSessionSettings.getState();
      apply({
        ...settingsOf(cur),
        sessions: cur.sessions.map((x) => {
          if (x.id !== id) return x;
          const next = { ...x };
          if (patch.start !== undefined && isValidHHMM(patch.start)) next.start = patch.start.trim();
          if (patch.end !== undefined && isValidHHMM(patch.end)) next.end = patch.end.trim();
          if (patch.fillColor !== undefined && isHex(patch.fillColor)) next.fillColor = patch.fillColor;
          if (patch.borderColor !== undefined && isHex(patch.borderColor))
            next.borderColor = patch.borderColor;
          if (
            patch.fillOpacity !== undefined &&
            patch.fillOpacity >= 0 &&
            patch.fillOpacity <= 1
          )
            next.fillOpacity = patch.fillOpacity;
          if (patch.borderWidth !== undefined && patch.borderWidth >= 0 && patch.borderWidth <= 5)
            next.borderWidth = Math.round(patch.borderWidth);
          if (
            patch.borderStyle === "solid" ||
            patch.borderStyle === "dashed" ||
            patch.borderStyle === "dotted"
          )
            next.borderStyle = patch.borderStyle;
          return next;
        }),
      });
    },
    resetDefaults: () => apply(structuredClone(DEFAULT_SESSION_SETTINGS)),
  };
});

function settingsOf(s: SessionSettingsState): SessionMarkerSettings {
  return { enabled: s.enabled, showLabels: s.showLabels, sessions: s.sessions };
}
