import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { themeInitScript } from "@/components/trade/theme-script";

export const metadata: Metadata = {
  title: {
    default: "TickLab — Bar Replay Backtester",
    template: "%s · TickLab",
  },
  description: "Offline bar-replay backtesting on manually imported price history.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript() }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
