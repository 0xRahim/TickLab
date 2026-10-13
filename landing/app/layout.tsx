import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TickLab — Replay the market. Master your strategy.",
    template: "%s · TickLab",
  },
  description:
    "TickLab is a free, open-source bar replay and backtesting app built for discretionary traders. Study historical price action, practice your setups, and refine your execution without risking real capital.",
  metadataBase: new URL("https://github.com/0xRahim/TickLab"),
  openGraph: {
    title: "TickLab — Replay the market. Master your strategy.",
    description:
      "Free, open-source bar replay and manual backtesting for discretionary traders.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
