"use client";

import { useToasts } from "./lib/toast";
import { cx } from "./lib/cx";

export function ToastStack() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-1.5">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cx(
            "pointer-events-auto rounded-md border px-2.5 py-1.5 text-left text-xs shadow-xl",
            t.kind === "ok" && "border-up/40 bg-surface text-foreground",
            t.kind === "err" && "border-down/40 bg-surface text-down",
            t.kind === "info" && "border-border bg-surface text-foreground",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
