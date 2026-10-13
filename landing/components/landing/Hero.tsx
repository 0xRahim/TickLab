"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { GithubIcon } from "./icons";
import { ReplayChart } from "./ReplayChart";

export function Hero() {
  const reduce = useReducedMotion();
  const anim = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
      };
  return (
    <section id="top" className="border-b border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:pt-16">
        <motion.div {...anim} transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-up" />
            Free and open source · Offline-first
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Replay the market.
            <br />
            Master your strategy.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            TickLab is a free, open-source bar replay and backtesting app built
            for discretionary traders. Study historical price action, practice
            your setups, and refine your execution without risking real capital.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Link
              href="#get-started"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
            >
              <GithubIcon className="h-4 w-4" />
              Explore on GitHub
            </Link>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 divide-x divide-border border-y border-border">
            {[
              ["Bar-by-bar", "replay"],
              ["Manual", "backtesting"],
              ["100% offline", "data"],
            ].map(([v, k]) => (
              <div key={k} className="px-3 py-2.5">
                <dt className="order-2 mt-0.5 block text-[11px] text-muted">{k}</dt>
                <dd className="text-[13px] font-semibold tracking-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div
          {...(reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 } })}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.2, 0, 0, 1] }}
          className="min-w-0"
        >
          <div className="overflow-hidden rounded-lg border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_28px_-12px_rgba(0,0,0,0.18)]">
            <ReplayChart />
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">
            Live simulation — deterministic sample data, no market-data API required.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
