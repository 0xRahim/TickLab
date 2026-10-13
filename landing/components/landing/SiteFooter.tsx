import Link from "next/link";
import { SITE } from "@/lib/site";

const COLS: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Project",
    links: [
      { label: "GitHub", href: SITE.githubUrl, external: true },
      { label: "Releases", href: SITE.releasesUrl, external: true },
      { label: "Issues", href: SITE.issuesUrl, external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: SITE.docsUrl, external: true },
      { label: "Data import guide", href: SITE.docsUrl, external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded bg-foreground font-mono text-[11px] font-bold text-background">
              T
            </span>
            <span className="text-sm font-bold tracking-tight">TickLab</span>
          </p>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted">
            Free, open-source bar replay and manual backtesting for
            discretionary traders. Practice without risking capital.
          </p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              {c.title}
            </p>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-[13px] text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-4 font-mono text-[11px] text-muted sm:px-6">
          <span>© {new Date().getFullYear()} TickLab contributors</span>
          <span className="ml-auto">Deterministic demo data · no live market feed</span>
        </div>
      </div>
    </footer>
  );
}
