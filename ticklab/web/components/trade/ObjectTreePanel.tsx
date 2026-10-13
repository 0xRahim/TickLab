"use client";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Eye,
  EyeOff,
  Layers,
  Lock,
  LockOpen,
  type LucideIcon,
  Minus,
  Square,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { cx } from "./lib/cx";
import type { DrawingLine } from "./drawings/constants";

const TYPE_META: Record<string, { icon: LucideIcon; label: string }> = {
  trendline: { icon: TrendingUp, label: "Trendline" },
  horizontal: { icon: Minus, label: "Horizontal" },
  vertical: { icon: Minus, label: "Vertical" },
  fibonacci: { icon: Layers, label: "Fibonacci" },
  fibextension: { icon: Layers, label: "Fib ext" },
  rectangle: { icon: Square, label: "Rectangle" },
  ellipse: { icon: Square, label: "Ellipse" },
  triangle: { icon: TrendingUp, label: "Triangle" },
  arrow: { icon: TrendingUp, label: "Arrow" },
  channel: { icon: TrendingUp, label: "Channel" },
  text: { icon: Minus, label: "Text" },
  position: { icon: TrendingUp, label: "Position" },
};

export interface ObjectTreePanelProps {
  drawings: DrawingLine[];
  selectedIds: string[];
  priceDigits: number;
  currentTf: string;
  onSelect: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onReorder: (d: DrawingLine, dir: "front" | "back") => void;
  onClose: () => void;
}

function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-muted hover:bg-border/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function ObjectTreeRow({
  d,
  selected,
  priceDigits,
  currentTf,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
}: {
  d: DrawingLine;
  selected: boolean;
  priceDigits: number;
  currentTf: string;
  onSelect: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onReorder: (d: DrawingLine, dir: "front" | "back") => void;
}) {
  const meta = TYPE_META[d.type] ?? { icon: Minus, label: d.type };
  const Icon = meta.icon;
  const tfOnly = d.visibility === "tf" && d.createdTf !== currentTf;
  return (
    <div
      className={cx(
        "group flex items-center gap-1.5 rounded px-2 py-1 text-xs",
        selected ? "bg-accent/15" : "hover:bg-border/40",
        (d.hidden || tfOnly) && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(d)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: d.color }}
        />
        <Icon className="h-3 w-3 shrink-0 text-muted" />
        <span className="flex-1 truncate">
          {meta.label} {d.price.toFixed(priceDigits)}
          {tfOnly && (
            <span className="ml-1 text-[9px] text-muted">({d.createdTf})</span>
          )}
        </span>
      </button>
      <div className="hidden items-center group-hover:flex">
        <RowIconButton title="Bring to front" onClick={() => onReorder(d, "front")}>
          <ArrowUpToLine className="h-3 w-3" />
        </RowIconButton>
        <RowIconButton title="Send to back" onClick={() => onReorder(d, "back")}>
          <ArrowDownToLine className="h-3 w-3" />
        </RowIconButton>
      </div>
      <RowIconButton
        title={d.hidden ? "Show" : "Hide"}
        onClick={() => onUpdate({ ...d, hidden: !d.hidden })}
      >
        {d.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </RowIconButton>
      <RowIconButton
        title={d.locked ? "Unlock" : "Lock"}
        onClick={() => onUpdate({ ...d, locked: !d.locked })}
      >
        {d.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
      </RowIconButton>
      <RowIconButton title="Delete" onClick={() => onRemove(d.id)}>
        <Trash2 className="h-3 w-3" />
      </RowIconButton>
    </div>
  );
}

/** Object tree: every drawing on the symbol, managed per row. */
export function ObjectTreePanel({
  drawings,
  selectedIds,
  priceDigits,
  currentTf,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
  onClose,
}: ObjectTreePanelProps) {
  return (
    <div className="absolute bottom-10 right-2 top-2 z-20 flex w-60 flex-col rounded-lg border border-border bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <span className="text-xs font-semibold">Objects ({drawings.length})</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close objects panel"
          className="rounded p-1 text-muted hover:bg-border/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1">
        {drawings.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted">No drawings yet</div>
        ) : (
          [...drawings]
            .reverse()
            .map((d) => (
              <ObjectTreeRow
                key={d.id}
                d={d}
                selected={selectedIds.includes(d.id)}
                priceDigits={priceDigits}
                currentTf={currentTf}
                onSelect={onSelect}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onReorder={onReorder}
              />
            ))
        )}
      </div>
    </div>
  );
}
