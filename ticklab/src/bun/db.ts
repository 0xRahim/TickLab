import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface SessionRow {
  id: string;
  name: string;
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionInstrumentRow {
  session_id: string;
  symbol: string;
  timeframe: string;
  from_iso: string;
  to_iso: string;
  expected_bars: number;
  cached_bars: number;
  status: string;
  error: string | null;
}

function dataDir(): string {
  return Bun.env.TICKLAB_DATA_DIR?.trim() || join(process.cwd(), "ticklab-data");
}

export function openDb(path?: string): Database {
  const dir = path ?? dataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "ticklab.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_instruments (
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      from_iso TEXT NOT NULL,
      to_iso TEXT NOT NULL,
      expected_bars INTEGER NOT NULL DEFAULT 0,
      cached_bars INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      PRIMARY KEY (session_id, symbol, timeframe),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0,
      is_open INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, interval, time)
    );
    CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(symbol, interval, time);
    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry REAL NOT NULL,
      exit REAL,
      sl REAL,
      tp REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      pnl REAL,
      reason TEXT,
      order_type TEXT NOT NULL DEFAULT 'market',
      limit_price REAL,
      stop_price REAL,
      commission REAL NOT NULL DEFAULT 0,
      leverage REAL NOT NULL DEFAULT 100,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      qty REAL NOT NULL,
      limit_price REAL,
      stop_price REAL,
      sl REAL,
      tp REAL,
      trail_dist REAL,
      risk_pct REAL,
      leverage REAL NOT NULL DEFAULT 100,
      expiry TEXT NOT NULL DEFAULT 'GTC',
      status TEXT NOT NULL DEFAULT 'pending',
      drawing_id TEXT,
      placed_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id, opened_at);
    CREATE TABLE IF NOT EXISTS session_progress (
      session_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      replay_cutoff INTEGER,
      replay_time INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
  db.exec("PRAGMA foreign_keys = ON;");
  // Lightweight migration for pre-existing ticklab.db files.
  for (const ddl of [
    "ALTER TABLE trades ADD COLUMN order_type TEXT NOT NULL DEFAULT 'market'",
    "ALTER TABLE trades ADD COLUMN limit_price REAL",
    "ALTER TABLE trades ADD COLUMN stop_price REAL",
    "ALTER TABLE trades ADD COLUMN commission REAL NOT NULL DEFAULT 0",
    "ALTER TABLE trades ADD COLUMN leverage REAL NOT NULL DEFAULT 100",
    "ALTER TABLE trades ADD COLUMN parent_id TEXT",
    "ALTER TABLE trades ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
  ]) {
    try {
      db.exec(`${ddl};`);
    } catch {
      // Column already exists — ignore.
    }
  }
  return db;
}
