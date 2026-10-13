"use client";

import { ArrowUpRight, FileText, History, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";
import { GithubIcon } from "./icons";
import { Reveal } from "./Reveal";

interface RepoStats {
  stars: number | null;
  latestRelease: string | null;
}

async function fetchRepoStats(signal: AbortSignal): Promise<RepoStats> {
  const res = await fetch(`https://api.github.com/repos/${SITE.githubRepo}`, { signal });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = (await res.json()) as { stargazers_count?: number };
  let latestRelease: string | null = null;
  try {
    // List endpoint returns 200 with [] when there are no releases yet
    // (unlike /releases/latest, which 404s) — keeps the console clean.
    const rel = await fetch(`https://api.github.com/repos/${SITE.githubRepo}/releases?per_page=1`, {
      signal,
    });
    if (rel.ok) {
      const r = (await rel.json()) as Array<{ tag_name?: string }>;
      latestRelease = r[0]?.tag_name ?? null;
    }
  } catch {
    /* releases are optional */
  }
  return {
    stars: typeof json.stargazers_count === "number" ? json.stargazers_count : null,
    latestRelease,
  };
}

export function OpenSource() {
  const [stats, setStats] = useState<RepoStats>({ stars: null, latestRelease: null });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRepoStats(ctrl.signal)
      .then(setStats)
      .catch(() => setStats({ stars: null, latestRelease: null }));
    return () => ctrl.abort();
  }, []);

  return (
    <section id="open-source" className="border-b border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <Reveal>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              05 · Open source
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Your trading workflow. No paywall.
            </h2>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
              TickLab is free and open source. Import your own history, run
              unlimited replay sessions locally, and inspect every line of the
              engine. If something{"'"}s missing, open an issue or send a pull request.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                href={SITE.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <GithubIcon className="h-4 w-4" />
                Star on GitHub
              </Link>
              <Link
                href={SITE.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
              >
                <FileText className="h-4 w-4" />
                Read the docs
              </Link>
            </div>
          </Reveal>
          <Reveal delay={0.14}>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs tabular-nums text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5" aria-hidden="true" />
                {stats.stars !== null ? `${stats.stars.toLocaleString()} stars` : "stars — live from GitHub"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                {stats.latestRelease ?? "releases on GitHub"}
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="min-w-0">
          <div className="overflow-hidden rounded-lg border border-border bg-background font-mono text-xs">
            <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
              <GithubIcon className="h-4 w-4" aria-hidden="true" />
              <span className="font-semibold">{SITE.githubRepo}</span>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Public</span>
              <Link
                href={SITE.githubUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open repository on GitHub"
                className="ml-auto rounded p-1 text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-1.5 px-3 py-3 text-muted">
              <p><span className="text-up">●</span> Offline bar-replay backtester (Electrobun desktop)</p>
              <p><span className="text-up">●</span> Next.js + lightweight-charts + Bun + SQLite</p>
              <p><span className="text-up">●</span> HistData.com CSV importer, sealed sessions</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {["typescript", "nextjs", "backtesting", "trading", "open-source"].map((t) => (
                  <span key={t} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-accent">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-up" /> TypeScript</span>
              <span>MIT-style openness — check the repo for license</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
