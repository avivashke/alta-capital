#!/usr/bin/env node
// Local development & Netlify-compatible server for Alta Capital.
// Serves static assets and mounts /api/db, /api/llm, and /api/firm-cron.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleDbRequest } from './netlify/functions/db.mjs';
import { handleLlmProxy } from './netlify/functions/llm.mjs';
import { runFirmCronJob } from './netlify/functions/firm-cron.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);
const PORT = Number(process.env.PORT || 8181);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (pathname === '/api/db' || pathname === '/.netlify/functions/db') {
    try {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const bodyObj = raw ? JSON.parse(raw) : {};
      const out = await handleDbRequest(req.method, bodyObj);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/llm' || pathname === '/.netlify/functions/llm') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const { status, text } = await handleLlmProxy(payload);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (pathname === '/api/firm-cron' || pathname === '/.netlify/functions/firm-cron') {
    try {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const bodyObj = raw ? JSON.parse(raw) : {};
      const out = await runFirmCronJob({ cycles: Number(bodyObj.cycles) || 2, deep: !!bodyObj.deep });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[Alta Capital] Server + DB + AI Proxy listening on http://localhost:${PORT}`);
});
