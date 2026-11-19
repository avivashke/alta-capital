// Local Machine AI Compute Discovery & Pool Registration.
// Auto-discovers free open-source models running on the user's machine (Ollama, LM Studio,
// llama.cpp, or Alta Capital Base Server /api/local-ai proxy) and registers them into
// the firm's rotating AI pool with zero API keys and zero rate limits.

import { addPoolEntry } from './keypool.js';

export const RECOMMENDED_LOCAL_MODELS = [
  {
    id: 'qwen2.5:3b',
    label: 'Qwen 2.5 3B',
    size: '~1.9 GB',
    ram: '6+ GB RAM',
    role: 'עברית מצוינת, JSON מדויק ומהיר מאוד גם על CPU',
  },
  {
    id: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    size: '~2.0 GB',
    ram: '6+ GB RAM',
    role: 'מודל Meta מהיר לגיבוי מקבילי והסברים חינוכיים',
  },
  {
    id: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    size: '~4.7 GB',
    ram: '12+ GB RAM',
    role: 'עברית חזקה במיוחד, ניתוח אסטרטגיות קוונט ו-AI Director',
  },
  {
    id: 'deepseek-r1:7b',
    label: 'DeepSeek R1 7B',
    size: '~4.7 GB',
    ram: '12+ GB RAM',
    role: 'חשיבה מעמיקה (Reasoning) לאופטימיזציה וביקורת אמת',
  },
];

async function fetchJsonFast(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover installed free local models across:
 * 1. Alta Capital Base Server proxy (/api/local-ai/status) — works even from phone/LAN!
 * 2. Direct Ollama (http://localhost:11434/api/tags)
 * 3. Direct LM Studio (http://localhost:1234/v1/models)
 */
export async function discoverLocalAiModels({ baseServerUrl = '' } = {}) {
  const found = [];
  const engines = [];
  const seen = new Set();

  const pushModel = (m) => {
    const k = `${m.engine}|${m.baseUrl}|${m.model}`;
    if (seen.has(k) || !m.model) return;
    seen.add(k);
    found.push(m);
  };

  // 1. Check Base Server /api/local-ai/status (same-origin OR configured baseServerUrl)
  const serverBases = [];
  if (typeof window !== 'undefined' && /^https?:/.test(window.location.origin)) {
    serverBases.push(window.location.origin);
  }
  if (baseServerUrl) {
    const norm = baseServerUrl.trim().replace(/\/+$/, '');
    if (norm && !serverBases.includes(norm)) serverBases.push(norm);
  }
  for (const origin of serverBases) {
    try {
      const data = await fetchJsonFast(`${origin}/api/local-ai/status`, 2500);
      if (data?.ok && Array.isArray(data.models) && data.models.length) {
        engines.push({
          engine: 'base-server-local-ai',
          label: `שרת בסיס (${data.hostname || 'מקומי'})`,
          url: `${origin}/api/local-ai/v1`,
          count: data.models.length,
        });
        for (const m of data.models) {
          pushModel({
            engine: m.engine || 'ollama',
            model: m.model || m.name,
            label: `🖥️ מקומי (שרת בסיס) · ${m.model || m.name}`,
            baseUrl: `${origin}/api/local-ai/v1`,
            sizeGB: m.sizeGB || null,
            viaBaseServer: true,
          });
        }
      }
    } catch { /* base server not reachable or not running local AI */ }
  }

  // 2. Direct Ollama on localhost:11434 (works both in Node and in browser when OLLAMA_ORIGINS=*)
  const ollamaHosts = typeof window === 'undefined'
    ? ['http://127.0.0.1:11434', 'http://localhost:11434']
    : ['http://localhost:11434'];
  for (const host of ollamaHosts) {
    try {
      const data = await fetchJsonFast(`${host}/api/tags`, 2000);
      const list = Array.isArray(data?.models) ? data.models : [];
      if (list.length) {
        engines.push({ engine: 'ollama', label: 'Ollama (מקומי)', url: `${host}/v1`, count: list.length });
        for (const m of list) {
          const name = m.name || m.model;
          if (!name) continue;
          pushModel({
            engine: 'ollama',
            model: name,
            label: `🖥️ Ollama מקומי · ${name}`,
            baseUrl: `${host}/v1`,
            sizeGB: m.size ? +(m.size / 1e9).toFixed(1) : null,
            viaBaseServer: false,
          });
        }
        break;
      }
    } catch { /* Ollama not running on this host */ }
  }

  // 3. Direct LM Studio on localhost:1234
  const lmHost = typeof window === 'undefined' ? 'http://127.0.0.1:1234' : 'http://localhost:1234';
  try {
    const data = await fetchJsonFast(`${lmHost}/v1/models`, 1800);
    const list = Array.isArray(data?.data) ? data.data : [];
    if (list.length) {
      engines.push({ engine: 'lmstudio', label: 'LM Studio (מקומי)', url: `${lmHost}/v1`, count: list.length });
      for (const m of list) {
        if (!m?.id) continue;
        pushModel({
          engine: 'lmstudio',
          model: m.id,
          label: `🖥️ LM Studio · ${m.id}`,
          baseUrl: `${lmHost}/v1`,
          sizeGB: null,
          viaBaseServer: false,
        });
      }
    }
  } catch { /* LM Studio not running */ }

  return {
    ok: found.length > 0,
    engines,
    models: found,
    checkedAt: Date.now(),
  };
}

/**
 * Add discovered free local machine models into the firm's AI Pool (no API key, unlimited usage).
 * Returns { addedCount, totalLocal }.
 */
export function syncLocalModelsToPool(state, models = []) {
  if (!state || !Array.isArray(models) || !models.length) return { addedCount: 0, totalLocal: 0 };
  let addedCount = 0;
  for (const m of models) {
    const res = addPoolEntry(state, {
      provider: 'ollama',
      label: m.label || `🖥️ מקומי · ${m.model}`,
      baseUrl: m.baseUrl,
      model: m.model,
      key: '',
      weight: 2,
      enabled: true,
    });
    if (!res.duplicate) addedCount++;
  }
  return { addedCount, totalLocal: models.length };
}
