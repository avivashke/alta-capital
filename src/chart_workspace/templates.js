// Chart Templates, Drawings Persistence & JSON Export/Import

const TEMPLATES_KEY = 'alta-tv-chart-templates-v1';
const DRAWINGS_KEY = 'alta-tv-chart-drawings-v1';

export function getSavedTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : defaultTemplates();
  } catch {
    return defaultTemplates();
  }
}

export function saveTemplate(name, config) {
  const all = getSavedTemplates();
  all[name] = {
    ...config,
    updatedAt: Date.now(),
    dateIso: new Date().toISOString(),
  };
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
  return all;
}

export function deleteTemplate(name) {
  const all = getSavedTemplates();
  delete all[name];
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
  return all;
}

export function defaultTemplates() {
  return {
    'ברירת מחדל · גאן ונרות': {
      chartType: 'candles',
      tf: '1h',
      layers: {
        gannLevels: true,
        swingMarkers: true,
        forecastZone: true,
        volume: true,
        ema50: true,
        ema200: true,
      },
    },
    'ניתוח מומנטום ומתנדים': {
      chartType: 'candles',
      tf: '15m',
      layers: {
        rsi: true,
        macd: true,
        bollinger: true,
        volume: true,
      },
    },
  };
}

export function getSavedDrawings(symbol) {
  try {
    const raw = localStorage.getItem(`${DRAWINGS_KEY}_${symbol}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol, drawings) {
  try {
    localStorage.setItem(`${DRAWINGS_KEY}_${symbol}`, JSON.stringify(drawings || []));
  } catch (err) {
    console.warn('[templates] failed to save drawings:', err.message);
  }
}
