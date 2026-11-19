#!/usr/bin/env node
// Always-On Base Server Supervisor for Alta Capital.
// Keeps server.mjs running 24/7, automatically restarts on unexpected exit with backoff,
// and appends timestamped logs to data/server.log.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_FILE = path.join(DATA_DIR, 'server.log');
fs.mkdirSync(DATA_DIR, { recursive: true });

let child = null;
let stopping = false;
let restarts = 0;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    // Rotate log if > 5 MB
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* ignore */ }
}

function startChild() {
  if (stopping) return;
  const startedAt = Date.now();
  log(`Starting Alta Capital Base Server (attempt #${restarts + 1})...`);
  child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ALTA_BASE_SERVER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    try { fs.appendFileSync(LOG_FILE, chunk); } catch { /* ignore */ }
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    try { fs.appendFileSync(LOG_FILE, chunk); } catch { /* ignore */ }
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    const ranMs = Date.now() - startedAt;
    restarts = ranMs > 60_000 ? 0 : restarts + 1;
    const delayMs = Math.min(30_000, 1500 * Math.pow(2, Math.min(restarts, 4)));
    log(`Base Server exited (code=${code}, signal=${signal}). Restarting in ${Math.round(delayMs / 1000)}s...`);
    setTimeout(startChild, delayMs);
  });
}

function shutdown(sig) {
  stopping = true;
  log(`Supervisor stopping (${sig})...`);
  if (child) child.kill(sig);
  setTimeout(() => process.exit(0), 2500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startChild();
