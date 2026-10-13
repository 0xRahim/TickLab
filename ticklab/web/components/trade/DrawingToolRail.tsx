"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Circle,
  Equal,
  EyeOff,
  Layers,
  Layers3,
  type LucideIcon,
  Minus,
  MousePointer2,
  MoveUpRight,
  MoveVertical,
  PenTool,
  Ruler,
  Spline,
  Square,
  TrendingUp,
  Triangle,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./lib/cx";
import type { DrawingTool } from "./drawings/constants";

interface ToolMeta {
  tool: DrawingTool;
  icon: LucideIcon;
  label: string;
}

interface ToolGroup {
  id: string;
  icon: LucideIcon;
  label: string;
  tools: ToolMeta[];
}

// Grouped tool palette mirroring the OpenCharts rail (full suite).
const GROUPS: ToolGroup[] = [
  {
    id: "lines",
    icon: TrendingUp,
    label: "Lines",
    tools: [
      { tool: "trendline", icon: TrendingUp, label: "Trend Line" },
      { tool: "ray", icon: MoveUpRight, label: "Ray" },
      { tool: "extended", icon: Spline, label: "Extended Line" },
      { tool: "horizontal", icon: Minus, label: "Horizontal Line" },
      { tool: "vertical", icon: MoveVertical, label: "Vertical Line" },
      { tool: "channel", icon: Equal, label: "Parallel Channel" },
    ],
  },
  {
    id: "fib",
    icon: Layers,
    label: "Fibonacci",
    tools: [
      { tool: "fibonacci", icon: Layers, label: "Fib Retracement" },
      { tool: "fibextension", icon: Layers3, label: "Fib Extension" },
    ],
  },
  {
    id: "shapes",
    icon: Square,
    label: "Shapes",
    tools: [
      { tool: "rectangle", icon: Square, label: "Rectangle" },
      { tool: "ellipse", icon: Circle, label: "Ellipse" },
      { tool: "triangle", icon: Triangle, label: "Triangle" },
      { tool: "arrow", icon: ArrowRight, label: "Arrow" },
    ],
  },
  {
    id: "trade",
    icon: ArrowUpRight,
    label: "Trade",
    tools: [
      { tool: "long-position", icon: ArrowUpRight, label: "Long Position" },
      { tool: "short-position", icon: ArrowDownRight, label: "Short Position" },
      { tool: "measure", icon: Ruler, label: "Measure" },
    ],
  },
  {
    id: "text",
    icon: Type,
    label: "Text",
    tools: [{ tool: "text", icon: Type, label: "Text" }],
  },
];

function RailButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        "rounded p-1.5 hover:bg-border/50",
        active ? "text-accent" : "text-muted",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
}: {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup]);

  const select = (t: DrawingTool) => {
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpenGroup(null);
  };

  if (hidden) {
    return (
      <button
        type="button"
        title="Show drawing tools"
        aria-label="Show drawing tools"
        onClick={() => setHidden(false)}
        className="rounded border border-border bg-surface p-1.5 text-muted hover:text-foreground"
      >
        <PenTool className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative flex flex-col items-center gap-0.5">
      <RailButton
        icon={MousePointer2}
        title="Cursor"
        active={drawingTool === "none"}
        onClick={() => {
          onDrawingTool("none");
          setOpenGroup(null);
        }}
      />
      {GROUPS.map((g) => {
        const activeMeta = g.tools.find((t) => t.tool === drawingTool);
        const Icon = activeMeta?.icon ?? g.icon;
        return (
          <div key={g.id} className="relative">
            <RailButton
              icon={Icon}
              title={g.label}
              active={Boolean(activeMeta)}
              onClick={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
            />
            {openGroup === g.id && (
              <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-md border border-border bg-surface py-1 shadow-xl">
                {g.tools.map((t) => (
                  <button
                    key={t.tool}
                    type="button"
                    onClick={() => select(t.tool)}
                    className={cx(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-border/50",
                      drawingTool === t.tool && "text-accent",
                    )}
                  >
                    <t.icon className="h-3.5 w-3.5 shrink-0" />
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="my-0.5 w-full border-t border-border/50" />
      <RailButton icon={EyeOff} title="Hide toolbar" onClick={() => setHidden(true)} />
    </div>
  );
}
