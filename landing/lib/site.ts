/** Central site + link configuration. No hardcoded GitHub URLs in components. */
export const SITE = {
  name: "TickLab",
  tagline: "Offline bar-replay backtesting",
  githubRepo: "0xRahim/TickLab",
  githubUrl: "https://github.com/0xRahim/TickLab",
  get docsUrl() {
    return `${this.githubUrl}/blob/main/ticklab/README.md`;
  },
  get issuesUrl() {
    return `${this.githubUrl}/issues`;
  },
  get releasesUrl() {
    return `${this.githubUrl}/releases`;
  },
  // App entry points (desktop app / local dev). Configurable per environment.
  appUrl: "/app",
  dataUrl: "/data",
  sessionUrl: "/session",
} as const;

export type SiteConfig = typeof SITE;
