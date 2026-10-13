import { ArrowRight, Code2 } from "lucide-react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <section id="get-started" className="border-b border-border bg-surface/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Get started
          </p>
          <h2 className="mx-auto mt-2 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
            The next candle is yours to study.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">
            Clone the repo, import history, and run your first sealed replay
            session — free, offline, and fully inspectable.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Code2 className="h-4 w-4" />
              View Source Code
            </Link>
          </div>
          <pre className="mx-auto mt-8 max-w-md overflow-x-auto rounded-lg border border-border bg-background px-4 py-3 text-left font-mono text-xs leading-relaxed text-muted">
            <code>{`git clone ${SITE.githubUrl}.git\ncd TickLab/ticklab/web && bun install\nbun run dev  # http://localhost:3000`}</code>
          </pre>
        </Reveal>
      </div>
    </section>
  );
}
