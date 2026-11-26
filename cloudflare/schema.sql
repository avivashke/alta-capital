-- Alta Capital — Cloudflare D1 Database Schema
-- Provides conflict-free, monotonic storage for trading firm state, bot versions, trades, and cycle logs.
-- Execute with:
--   npx wrangler d1 execute alta-db --file=cloudflare/schema.sql

CREATE TABLE IF NOT EXISTS firm_state (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  cycles INTEGER DEFAULT 0,
  backtests INTEGER DEFAULT 0,
  deployments INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS firm_versions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS firm_trades (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS firm_cycles (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_firm_versions_created ON firm_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_firm_trades_created ON firm_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_firm_cycles_created ON firm_cycles(created_at DESC);
