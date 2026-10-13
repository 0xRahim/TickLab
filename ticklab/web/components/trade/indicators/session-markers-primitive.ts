/**
 * Session Markers primitive — OpenCharts §8-style overlay (cf. upstream
 * `bands-indicator.ts` / `session-highlighting.ts`): extends the vendored
 * `PluginBase`, converts data-space to pixels only inside the render pass,
 * and paints in `drawBackground` so candles stay on top.
 *
 * Each window is a box from its start/end time (x) fitted to the window's
 * [low, high] (y), with per-session fill/border styling and an optional
 * session label at the top-left of the box.
 */
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
} from "lightweight-charts";
import { PluginBase } from "../lib/chart-plugins/plugin-base";
import { makeResolveCtx, timeToX } from "../lib/chart-plugins/drawing-tools/resolve";
import type { SessionBorderStyle, SessionWindow } from "./sessions";

interface ResolvedBox {
  x1: number | null;
  x2: number | null;
  yHigh: number | null;
  yLow: number | null;
  label: string;
  fillColor: string;
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: SessionBorderStyle;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const v = Number.parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function dashFor(style: SessionBorderStyle, ratio: number): number[] {
  if (style === "dashed") return [6 * ratio, 4 * ratio];
  if (style === "dotted") return [2 * ratio, 3 * ratio];
  return [];
}

class SessionMarkersPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private readonly _boxes: ResolvedBox[];
  private readonly _showLabels: boolean;

  constructor(boxes: ResolvedBox[], showLabels: boolean) {
    this._boxes = boxes;
    this._showLabels = showLabels;
  }

  drawBackground(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const maxX = scope.bitmapSize.width;
      for (const b of this._boxes) {
        if (b.yHigh === null || b.yLow === null) continue;
        if (b.x1 === null && b.x2 === null) continue;
        const x1 = Math.round((b.x1 ?? 0) * scope.horizontalPixelRatio);
        const x2 = Math.round((b.x2 ?? maxX / scope.horizontalPixelRatio) * scope.horizontalPixelRatio);
        if (x2 <= 0 || x1 >= maxX || x2 - x1 < 2) continue;
        const y1 = Math.round(b.yHigh * scope.verticalPixelRatio);
        const y2 = Math.round(b.yLow * scope.verticalPixelRatio);
        const top = Math.min(y1, y2);
        const h = Math.abs(y2 - y1);
        if (h < 2) continue;
        ctx.save();
        ctx.fillStyle = hexToRgba(b.fillColor, b.fillOpacity);
        ctx.fillRect(x1, top, x2 - x1, h);
        if (b.borderWidth > 0) {
          ctx.strokeStyle = b.borderColor;
          ctx.lineWidth = Math.max(1, b.borderWidth * scope.verticalPixelRatio);
          ctx.setLineDash(dashFor(b.borderStyle, scope.horizontalPixelRatio));
          ctx.strokeRect(x1 + 0.5, top + 0.5, x2 - x1 - 1, h - 1);
          ctx.setLineDash([]);
        }
        if (this._showLabels && b.label) {
          const fs = Math.round(10 * scope.verticalPixelRatio);
          ctx.font = `600 ${fs}px system-ui, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillStyle = b.borderColor;
          ctx.fillText(b.label, x1 + 4 * scope.horizontalPixelRatio, top + 3 * scope.verticalPixelRatio);
        }
        ctx.restore();
      }
    });
  }

  draw(): void {
    // Everything paints behind the candles in drawBackground.
  }
}

class SessionMarkersPaneView implements ISeriesPrimitivePaneView {
  private readonly _source: SessionMarkersPrimitive;
  private _boxes: ResolvedBox[] = [];

  constructor(source: SessionMarkersPrimitive) {
    this._source = source;
  }

  update(): void {
    // Session edges rarely sit on this TF's bar grid (aggregated TFs stamp
    // bars at group opens offset from wall-clock hours), and
    // `timeToCoordinate` returns null for off-grid times. Use the shared
    // `timeToX` resolver (same as drawings): direct mapping when exact,
    // logical-index interpolation otherwise.
    const ctx = makeResolveCtx(
      this._source.chart,
      this._source.series,
      this._source.intervalSec(),
    );
    const series = this._source.series;
    this._boxes = this._source.windows().map((w) => ({
      x1: timeToX(ctx, w.startTime),
      x2: timeToX(ctx, w.endTime),
      yHigh: series.priceToCoordinate(w.high),
      yLow: series.priceToCoordinate(w.low),
      label: w.label,
      fillColor: w.fillColor,
      fillOpacity: w.fillOpacity,
      borderColor: w.borderColor,
      borderWidth: w.borderWidth,
      borderStyle: w.borderStyle,
    }));
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SessionMarkersPaneRenderer(this._boxes, this._source.showLabels());
  }
}

export class SessionMarkersPrimitive extends PluginBase {
  private _windows: SessionWindow[] = [];
  private _showLabels = true;
  private _intervalSec = 60;
  private readonly _paneViews: SessionMarkersPaneView[];

  constructor() {
    super();
    this._paneViews = [new SessionMarkersPaneView(this)];
  }

  /** Bar interval of the series data — drives off-grid time interpolation. */
  setIntervalSec(intervalSec: number): void {
    if (this._intervalSec === intervalSec) return;
    this._intervalSec = intervalSec;
    this.requestUpdate();
  }

  intervalSec(): number {
    return this._intervalSec;
  }

  setWindows(windows: SessionWindow[]): void {
    this._windows = windows;
    this.requestUpdate();
  }

  setShowLabels(show: boolean): void {
    if (this._showLabels === show) return;
    this._showLabels = show;
    this.requestUpdate();
  }

  windows(): readonly SessionWindow[] {
    return this._windows;
  }

  showLabels(): boolean {
    return this._showLabels;
  }

  updateAllViews(): void {
    for (const v of this._paneViews) v.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }
}
