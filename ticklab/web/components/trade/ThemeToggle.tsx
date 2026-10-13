"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY } from "./theme-script";

function initialDark(): boolean {
  if (typeof window === "undefined") return false;
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "dark") return true;
  if (saved === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  // Deterministic initial state so server HTML matches the first client
  // render. The real theme is synced from the DOM after mount to avoid a
  // hydration mismatch (server has no `document`).
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  }

  if (!mounted) {
    // Placeholder keeps server + pre-hydration client markup identical
    // and preserves header layout (no shift once the real icon loads).
    return (
      <button
        type="button"
        disabled
        aria-label="Toggle theme"
        className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Moon size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export { initialDark };
