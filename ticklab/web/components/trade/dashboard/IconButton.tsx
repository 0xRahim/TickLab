"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

type Variant = "ghost" | "outline" | "primary" | "danger";

const VARIANTS: Record<Variant, string> = {
  ghost: "text-muted hover:bg-border/50 hover:text-foreground",
  outline: "border border-border text-foreground hover:bg-border/50",
  primary: "bg-accent text-white hover:opacity-90",
  danger: "border border-down/40 text-down hover:bg-down/10",
};

/** Icon-only action button (lucide child). Text buttons are out — every
 * action across the dashboard uses this with a tooltip + aria-label. */
export function IconButton({
  title,
  label,
  onClick,
  href,
  variant = "ghost",
  disabled,
  className,
  children,
}: {
  title: string;
  label?: string;
  onClick?: () => void;
  href?: string;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = cx(
    "inline-flex items-center justify-center rounded-md p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    className,
  );
  if (href !== undefined) {
    return (
      <Link href={href} title={title} aria-label={label ?? title} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" title={title} aria-label={label ?? title} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
