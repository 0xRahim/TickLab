/**
 * Session Markers settings dialog — per-session enable, UK-time window,
 * fill + border styling, labels toggle, master switch, reset to defaults.
 * Settings apply globally (all symbols) and persist via the session store.
 */
"use client";

import { RotateCcw, X } from "lucide-react";
import { isValidHHMM, type SessionBorderStyle, type SessionDef } from "./indicators/sessions";
import { useSessionSettings } from "./indicators/session-settings-store";
import { cx } from "./lib/cx";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

function TimeInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      {label}
      <input
        key={value}
        type="time"
        defaultValue={value}
        aria-label={`${label} time`}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== value && isValidHHMM(v)) onCommit(v);
          else e.target.value = value;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
      />
    </label>
  );
}

function SessionSection({ session }: { session: SessionDef }) {
  const { setSessionEnabled, updateSession } = useSessionSettings();
  return (
    <fieldset className="space-y-2 rounded-md border border-border/60 p-2">
      <legend className="px-1">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={session.enabled}
            onChange={(e) => setSessionEnabled(session.id, e.target.checked)}
          />
          {session.label}
        </label>
      </legend>
      <div className={cx(!session.enabled && "pointer-events-none opacity-40")}>
        <div className="flex items-center gap-2">
          <TimeInput
            label="Start"
            value={session.start}
            onCommit={(v) => updateSession(session.id, { start: v })}
          />
          <TimeInput
            label="End"
            value={session.end}
            onCommit={(v) => updateSession(session.id, { end: v })}
          />
        </div>
        <Row label="Fill">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={session.fillColor}
              aria-label={`${session.label} fill color`}
              onChange={(e) => updateSession(session.id, { fillColor: e.target.value })}
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={session.fillOpacity}
              aria-label={`${session.label} fill opacity`}
              onChange={(e) => updateSession(session.id, { fillOpacity: Number(e.target.value) })}
              className="w-20"
            />
          </div>
        </Row>
        <Row label="Border">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={session.borderColor}
              aria-label={`${session.label} border color`}
              onChange={(e) => updateSession(session.id, { borderColor: e.target.value })}
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
            <select
              value={session.borderWidth}
              aria-label={`${session.label} border width`}
              onChange={(e) => updateSession(session.id, { borderWidth: Number(e.target.value) })}
              className="rounded border border-border bg-background px-1 py-1 text-xs"
            >
              {[0, 1, 2, 3].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
            <select
              value={session.borderStyle}
              aria-label={`${session.label} border style`}
              onChange={(e) =>
                updateSession(session.id, { borderStyle: e.target.value as SessionBorderStyle })
              }
              className="rounded border border-border bg-background px-1 py-1 text-xs"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
        </Row>
      </div>
    </fieldset>
  );
}

export function SessionMarkersDialog({ onClose }: { onClose: () => void }) {
  const { enabled, showLabels, sessions, setEnabled, setShowLabels, resetDefaults } =
    useSessionSettings();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="max-h-full w-80 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-2xl">
        <div className="flex select-none items-center justify-between">
          <span className="text-sm font-semibold">Session Markers</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session settings"
            className="rounded p-1 text-muted hover:bg-border/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <Row label="Indicator">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </Row>
        <Row label="Labels">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Show names
          </label>
        </Row>
        <p className="text-[11px] leading-snug text-muted">
          Times are UK time (Europe/London). Hidden on 1D/1W timeframes.
        </p>

        {sessions.map((s) => (
          <SessionSection key={s.id} session={s} />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-2">
          <button
            type="button"
            onClick={resetDefaults}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-border/50 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
