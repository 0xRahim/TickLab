import {
  BarChart3,
  Crosshair,
  Database,
  Eye,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";
import { Reveal } from "./Reveal";

const FEATURES = [
  {
    icon: Eye,
    title: "Bar-by-bar replay",
    copy: "Play, step, scrub, and jump across sealed history. The future stays hidden until you reveal it.",
  },
  {
    icon: Crosshair,
    title: "Manual strategy testing",
    copy: "Place market, limit, and stop orders with risk-based sizing. You call every trade — nothing auto-optimizes.",
  },
  {
    icon: NotebookPen,
    title: "Setup & execution review",
    copy: "Draw levels, log decisions, and compare what you planned against what actually printed.",
  },
  {
    icon: ShieldCheck,
    title: "Distraction-free and offline",
    copy: "Manually imported history in local SQLite storage. No feed, no noise, no account needed.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Workflow
          </p>
          <h2 className="mt-2 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
            Built for discretionary traders
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            A serious practice environment for people who read charts
            themselves — not a bot platform, not a signal feed.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={Math.min(i * 0.07, 0.21)} className="bg-background">
              <div className="group h-full px-6 py-7 transition-colors hover:bg-surface/60">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background transition-transform duration-300 group-hover:-translate-y-0.5">
                  <f.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{f.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1}>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] tabular-nums text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" aria-hidden="true" /> HistData.com M1 CSV import
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> M1 → 5m · 15m · 30m · 1H · 4H · 1D · 1W
            </span>
            <span>BTCUSD · EURUSD · GBPUSD · XAUUSD · USDCAD</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
