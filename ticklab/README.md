# TickLab — Offline Bar-Replay Backtester (Electrobun)

Create a backtest session → pick instruments + date range → seal against
manually imported history → replay bars TradingView-style, paper-trade,
draw — all offline from the local bundle.

## Stack

- `web/` — Next.js 16 (static export) + Tailwind v4 + lightweight-charts v4.
  Chart/replay/paper/drawings/session-markers ported from Tradeye (`tradeye-ui`).
- `src/bun/` — Bun backend: sessions CRUD, HistData.com CSV importer,
  **local-only** candle serving, SQLite persistence (`bun:sqlite`).
- Electrobun window loads the backend over `http://127.0.0.1:4578/` (same origin
  for app + API, works in dev and in the packaged app).

## Prereqs

- Bun 1.4.2. No API keys — price data is imported manually (see Data import).

## Setup

```bash
cd web && bun install && cd ..
```

## Data import

HistData.com M1 CSVs (`YYYYMMDD HHMMSS;O;H;L;C;V` rows in US Eastern wall
time → stored as UTC epochs, charts render UK time) are imported from the
**Candlestick data** page (`/data`): pick a symbol, select one or more CSV
files (any size, filename-sorted before import) — they upload sequentially
and resample into M1 plus all higher timeframes (5m…1w). Re-runs upsert, so
overlapping files are safe.

Dev/scripting equivalent (same processing):

```bash
bun src/bun/import-histdata.ts --symbol EURUSD /path/to/price_data/EUR-USD/m1
```

## Dev

Terminal 1 — web:

```bash
cd web && bun run dev         # http://localhost:3000
```

Terminal 2 — backend API (no Electrobun needed):

```bash
bun src/bun/server.ts
# API on http://127.0.0.1:4578
```

With `TICKLAB_WEB_URL=http://localhost:3000` in `.env` (dev default), the
backend is API-only and the UI comes from `next dev`. Comment it out to have
the backend serve the packaged export (`web/out`) itself on `:4578`.
Full desktop window: `hutch run dev` (uses `src/bun/index.ts` entrypoint).

## Build & package

```bash
cd web && bun run build && cd ..        # static export → web/out
hutch electrobun build --env=stable     # packaged app in build/
```

(`hutch` is at `~/.hutch/bin/hutch` if not on PATH.)

## Workflow

1. `/` — create session (name, 1+ instruments, timeframes, from/to) → seals
   against imported local history, then the session flips to `ready`.
   Instruments without local coverage fail with an import hint.
2. Open a `ready` session → full sealed range loads from SQLite into memory.
3. Replay (play/step/speed/scrub) reveals bars `time <= replayTime` on all
   timeframes; paper engine marks full bar high/low per step; drawings persist
   per (session, symbol); session-marker bands overlay UK trading sessions.

## Offline invariant

Backtesting never touches the network: `src/bun/local-candles.ts` never calls
`fetch()`; the session frontend (`SessionTerminal`,
`useSessionMarketData`, `useSessionDrawings`, `useSessionLineAlerts`,
`session-api`) never imports the live feed (`ws`, `market-api`, quotes).
There is no network price feed anywhere — data arrives only via the CSV
importer (`src/bun/histdata.ts`, `POST /api/import`).

## Verify

```bash
cd web && bun run lint && bun run build
```

## Data

SQLite at `./ticklab-data/ticklab.db` (override with `TICKLAB_DATA_DIR`):
`sessions`, `session_instruments` (seal status per symbol/timeframe),
`candles` (shared cache keyed by symbol/interval/time), `drawings`, `trades`.
Deleting a session removes its drawings/trades; cached candles are shared.
