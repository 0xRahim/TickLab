# TickLab Landing Page

Standalone marketing site for TickLab — the free, open-source bar replay and
manual backtesting app for discretionary traders.

This project is intentionally separate from `../ticklab/web` (the Electrobun
desktop app) so landing iterations never break the packaged app.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- `lightweight-charts` v4 for the realistic replay animation
- `motion` for scroll reveals, `lucide-react` icons

## Develop

```bash
bun install
bun run dev   # http://localhost:3000
```

## Build

```bash
bun run lint && bun run build
```

## Notes

- Chart data is deterministic sample OHLC (`lib/sample-ohlc.ts`) — no market-data API.
- GitHub stars/releases load client-side from the public API with graceful fallback; no metrics are fabricated.
- All external URLs live in `lib/site.ts`.
