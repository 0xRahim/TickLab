import { openDb } from "./db";
import { HISTDATA_SOURCE_TZ, importHistDataDir, normalizeSymbol } from "./histdata";

/**
 * Bulk HistData.com import (dev/scripting path).
 *
 *   bun src/bun/import-histdata.ts --symbol EURUSD [--tz America/New_York] <csv-dir>
 *
 * Thin wrapper over the shared streaming core (`createHistImport` in
 * histdata.ts) — the GUI bulk import on the `/data` page runs the exact same
 * processing. Walks <csv-dir> recursively for `*.csv` (HistData
 * `YYYYMMDD HHMMSS;O;H;L;C;V` M1 rows), stores M1 plus all resampled higher
 * timeframes in SQLite. Idempotent — re-running overlapping folders only
 * upserts.
 */

function usage(): never {
  console.error(
    "Usage: bun src/bun/import-histdata.ts --symbol EURUSD [--tz America/New_York] <csv-dir>",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
let symbol: string | null = null;
let tz = process.env.TICKLAB_HISTDATA_TZ?.trim() || HISTDATA_SOURCE_TZ;
let dir: string | null = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--symbol" && i + 1 < args.length) symbol = args[++i]!;
  else if (a === "--tz" && i + 1 < args.length) tz = args[++i]!;
  else if (!a.startsWith("--") && dir == null) dir = a;
  else usage();
}
if (!symbol || !dir) usage();

const t0 = Date.now();
const db = openDb();
const summary = await importHistDataDir(db, dir!, normalizeSymbol(symbol!), {
  sourceTz: tz,
  onProgress: (msg) => console.log(`[import] ${msg}`),
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[import] ${symbol} ← ${summary.files} files, ${summary.m1Bars} M1 bars (${summary.skipped} skipped) in ${secs}s`);
for (const [interval, n] of Object.entries(summary.perInterval)) {
  console.log(`[import]   ${interval}: ${n} bars`);
}
if (summary.from != null && summary.to != null) {
  console.log(
    `[import] range: ${new Date(summary.from * 1000).toISOString()} → ${new Date(summary.to * 1000).toISOString()}`,
  );
}
