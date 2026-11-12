// Minimal file-backed localStorage so src/store.js runs unchanged under Node.

import fs from 'node:fs';
import path from 'node:path';

export function installFileStorage({ cacheFile, seedFile, key }) {
  let mem = {};
  if (fs.existsSync(cacheFile)) {
    try {
      mem = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      mem = {};
    }
  }
  if (seedFile && !mem[key] && fs.existsSync(seedFile)) {
    try {
      const raw = fs.readFileSync(seedFile, 'utf8');
      JSON.parse(raw);
      mem[key] = raw;
    } catch {
      /* no usable seed */
    }
  }

  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(mem));
    } catch (err) {
      console.warn('[storage] persist failed:', err.message);
    }
  };

  globalThis.localStorage = {
    get length() {
      return Object.keys(mem).length;
    },
    key(i) {
      return Object.keys(mem)[i] ?? null;
    },
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    setItem(k, v) {
      mem[k] = String(v);
      persist();
    },
    removeItem(k) {
      delete mem[k];
      persist();
    },
    clear() {
      mem = {};
      persist();
    },
  };

  return { seed: () => mem[key] || null };
}
