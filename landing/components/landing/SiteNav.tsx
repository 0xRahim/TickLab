"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SITE } from "@/lib/site";

const LINKS = [
  { label: "Features", href: "#features" },
  { label: "Open source", href: "#open-source" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
      <nav aria-label="Primary" className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="#top" className="flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-accent">
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded bg-foreground font-mono text-[11px] font-bold text-background">
            T
          </span>
          <span className="text-[15px] font-bold tracking-tight">TickLab</span>
          <span className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted md:inline">
            Free · Open source
          </span>
        </Link>
        <div className="ml-6 hidden items-center gap-5 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13px] text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent sm:inline-flex"
          >
            GitHub
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="#get-started"
            className="rounded-md bg-foreground px-3 py-1.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Get Started
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="border-t border-border px-4 py-2 lg:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-2 text-sm text-muted hover:bg-surface hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded px-2 py-2 text-sm text-muted hover:bg-surface hover:text-foreground"
          >
            GitHub ↗
          </Link>
        </div>
      )}
    </header>
  );
}
