import { mount } from '../ui.js';
import { store } from '../store.js';
import { LLM_PROVIDERS, PLATFORMS, DISCLAIMER } from '../config.js';
import { testConnection, testPoolEntry } from '../llm.js';
import { PROVIDERS, PROVIDER_ORDER } from '../providers.js';
import { addPoolEntry, entryStatus, limitsFor, movePoolEntry, parseCloudflareKeys, poolEntries, poolStats, removePoolEntry, resetCooldowns } from '../keypool.js';
import { h, notice, toast, openModal, downloadFile, timeAgo, tag } from '../ui.js';
import { syncFromCloud } from '../remote.js';
import * as webllm from '../webllm.js';

export function renderSettings(root, ui) {
  const s = store.state.settings;

  const provider = h('select', {
    onchange: (e) => {
      const p = LLM_PROVIDERS[e.target.value];
      if (p) {
        baseUrl.value = p.baseUrl;
        model.value = p.model;
        keyInput.placeholder = p.keyHint || '';
      }
    },
  }, Object.entries(LLM_PROVIDERS).map(([k, p]) => h('option', { value: k, selected: s.llm.provider === k }, p.label)));

  const baseUrl = h('input', { type: 'url', value: s.llm.baseUrl || '', placeholder: 'https://api.openai.com/v1', dir: 'ltr' });
  const model = h('input', { type: 'text', value: s.llm.model || '', placeholder: 'gpt-4o-mini', dir: 'ltr' });
  const keyInput = h('input', { type: 'password', value: s.llm.apiKey || '', placeholder: 'sk-...', dir: 'ltr', autocomplete: 'off' });
  const temperature = h('input', { type: 'number', min: '0', max: '1.5', step: '0.1', value: s.llm.temperature });

  const autopilot = h('input', { type: 'checkbox', checked: s.autopilot });
  const tickSeconds = h('input', { type: 'number', min: '3', max: '120', value: s.tickSeconds });
  const capital = h('input', { type: 'number', min: '100', step: '500', value: s.capital });
  const risk = h('input', { type: 'number', min: '0.1', max: '10', step: '0.1', value: +(s.riskPerTrade * 100).toFixed(2) });
  const maxDd = h('input', { type: 'number', min: '5', max: '90', step: '1', value: +(s.maxDrawdown * 100).toFixed(0) });
  const minTrades = h('input', { type: 'number', min: '3', max: '100', value: s.minTrades });
  const minPf = h('input', { type: 'number', min: '0.5', max: '3', step: '0.05', value: s.minProfitFactor });
  const minRobust = h('input', { type: 'number', min: '0', max: '100', step: '1', value: s.minRobustness ?? 50 });
  const cloudSync = h('input', { type: 'checkbox', checked: s.cloudSync !== false });
  const delta = h('input', { type: 'number', min: '0.1', max: '20', step: '0.1', value: s.promotionDelta });
  const platform = h('select', {}, Object.entries(PLATFORMS).map(([k, p]) => h('option', { value: k, selected: s.platform === k }, `${p.label} (${p.lang})`)));

  const ghToken = h('input', { type: 'password', value: s.github.token || '', placeholder: 'github_pat_...', dir: 'ltr', autocomplete: 'off' });
  const ghOwner = h('input', { type: 'text', value: s.github.owner || '', placeholder: 'your-username', dir: 'ltr' });
  const ghRepo = h('input', { type: 'text', value: s.github.repo || '', placeholder: 'alta-context', dir: 'ltr' });
  const ghPath = h('input', { type: 'text', value: s.github.path || 'firm/context.json', dir: 'ltr' });

  const newsEndpoint = h('input', { type: 'url', value: s.news.endpoint || '', placeholder: 'https://newsapi.org/v2/everything?q=bitcoin&language=he', dir: 'ltr' });
  const newsKey = h('input', { type: 'password', value: s.news.apiKey || '', placeholder: 'API key', dir: 'ltr', autocomplete: 'off' });

  const save = () => {
    store.mutate((st) => {
      st.settings.llm = {
        provider: provider.value,
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        apiKey: keyInput.value.trim(),
        temperature: Number(temperature.value) || 0.4,
      };
      st.settings.autopilot = autopilot.checked;
      st.settings.tickSeconds = Math.max(3, Number(tickSeconds.value) || 7);
      st.settings.capital = Math.max(100, Number(capital.value) || 25000);
      st.settings.riskPerTrade = Math.min(0.1, Math.max(0.001, (Number(risk.value) || 1.5) / 100));
      st.settings.maxDrawdown = Math.min(0.9, Math.max(0.05, (Number(maxDd.value) || 30) / 100));
      st.settings.minTrades = Math.max(3, Number(minTrades.value) || 10);
      st.settings.minProfitFactor = Math.max(0.5, Number(minPf.value) || 1.15);
      st.settings.minRobustness = Math.max(0, Math.min(100, Number(minRobust.value) || 50));
      st.settings.cloudSync = cloudSync.checked;
      st.settings.promotionDelta = Math.max(0.1, Number(delta.value) || 0.1);
      st.settings.platform = platform.value;
      st.settings.github = { token: ghToken.value.trim(), owner: ghOwner.value.trim(), repo: ghRepo.value.trim(), path: ghPath.value.trim() || 'firm/context.json' };
      st.settings.news = { endpoint: newsEndpoint.value.trim(), apiKey: newsKey.value.trim() };
      store.log('info', 'ניהול', 'ההגדרות עודכנו');
    });
    toast('ההגדרות נשמרו', 'ok');
  };

  const importFile = h('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        store.importJson(await file.text());
        toast('המצב נטען מהקובץ', 'ok');
        ui.go('overview');
      } catch (err) {
        toast('טעינה נכשלה: ' + err.message, 'bad');
      }
    },
  });

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Control room' }),
        h('h1', { text: 'הגדרות ומפתחות' }),
        h('p', { text: 'כאן מחברים מודל, מגדירים סיכון, בוחרים פלטפורמת בוט ומחברים את זיכרון החברה לריפו GitHub.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary', onclick: save }, 'שמור הכל'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            save();
            try { const r = await testConnection(); toast('המודל ענה: ' + r, 'ok'); }
            catch (err) { toast('כשל בחיבור: ' + err.message, 'bad'); }
          },
        }, 'שמור ובדוק מודל'),
      ),
    ),
    notice('המפתחות נשמרים ב-localStorage של הדפדפן הזה בלבד. אין שרת, אין בסיס נתונים ואין שליחת מפתחות לשום מקום מלבד ספק המודל. אל תעלה קובץ הגדרות עם מפתחות לריפו ציבורי.', 'bad'),
  );

  mount(root, poolCard(ui));
  mount(root, webllmCard(ui));
  mount(root, tradingviewCard(ui));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'מודל AI ראשי' }), h('div', { class: 'card-sub', text: 'ברירת מחדל / פרוקסי — הבריכה מעליו קודמת' }))),
      h('div', { class: 'form-grid' },
        field('ספק', provider),
        field('שם מודל', model),
        field('כתובת API', baseUrl),
        field('טמפרטורה', temperature),
        h('div', { class: 'full' }, field('מפתח API (נשמר מקומית)', keyInput)),
      ),
      notice('ספקים שחוסמים בקשות דפדפן (CORS) לא יעבדו ישירות מהאתר. במצב כזה אפשר להריץ פרוקסי מקומי, או להשתמש ב-OpenRouter/Groq/Gemini שתומכים בקריאה מהדפדפן.', 'blue'),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'שמור הגדרות API'),
        h('button', { class: 'btn btn-sm', onclick: async () => { save(); try { const r = await testConnection(); toast('המודל ענה: ' + r, 'ok'); } catch (err) { toast('כשל בחיבור: ' + err.message, 'bad'); } } }, 'שמור ובדוק חיבור'),
      ),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'סיכון והפעלה' }), h('div', { class: 'card-sub', text: 'שערי הקידום והקצאת ההון' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, h('label', { class: 'check' }, autopilot, 'אוטופיילוט — הסוכנים רצים לבד כל כמה שניות')),
        field('שניות בין מחזורים', tickSeconds),
        field('הון מדומה ($)', capital),
        field('סיכון לעסקה (%)', risk),
        field('Max DD (%)', maxDd),
        field('מינימום עסקאות', minTrades),
        field('Profit Factor מינימלי', minPf),
        field('חוסן סטטיסטי מינימלי (0-100)', minRobust),
        field('סף שיפור לגרסה (%)', delta),
        h('div', { class: 'full' }, field('פלטפורמת יעד לקוד', platform)),
      ),
      h('div', { class: 'small muted', style: { marginTop: '8px' } },
        'הסף קובע מתי נפתחת גרסה חדשה: שיפור של ' + s.promotionDelta + '% ומעלה ב-OOS, בתנאי שהמדדים עוברים את שערי הסיכון.',
      ),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'זיכרון החברה ב-GitHub' }), h('div', { class: 'card-sub', text: 'Contents API · טוקן fine-grained עם contents:write' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, field('טוקן GitHub', ghToken)),
        field('Owner', ghOwner),
        field('Repository', ghRepo),
        h('div', { class: 'full' }, field('נתיב הקובץ בריפו', ghPath)),
      ),
      fun('אפשר לשמור את הקונטקסט (פרמטרים, מדדים, רעיונות) בכל מחזור או ידנית ממסך המחקר.'),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'חדשות ורשתות' }), h('div', { class: 'card-sub', text: 'endpoint שמחזיר JSON עם articles/items/data' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, field('כתובת endpoint', newsEndpoint)),
        h('div', { class: 'full' }, field('מפתח (אופציונלי)', newsKey)),
      ),
      fun('דוגמה: NewsAPI — https://newsapi.org/v2/everything?q=bitcoin&language=he. אפשר גם RSS-to-JSON. Reddit ו-Fear & Greed עובדים ללא מפתח.'),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'הרצה 24/7 בענן' }), h('div', { class: 'card-sub', text: 'GitHub Actions כותב data/state.json והדשבורד קורא משם' })),
      store.state.remote?.updatedAt ? tag('ענן מחובר', 'live') : tag('מקומי בלבד', 'dry'),
    ),
    h('div', { class: 'form-grid' },
      h('div', { class: 'full' }, h('label', { class: 'check' }, cloudSync, 'טען מצב מהענן אוטומטית (מכבה אוטופיילוט מקומי כדי שלא ירוצו שני מנועים)')),
      h('div', { class: 'full' },
        h('div', { class: 'small muted' },
          store.state.remote?.updatedAt
            ? `עדכון אחרון מהענן: ${new Date(store.state.remote.updatedAt).toLocaleString('he-IL')} · ${store.state.remote.cycles || 0} מחזורים · מקור ${store.state.remote.source}`
            : 'לא נמצא data/state.json. אחרי שה־runner הראשון ידחוף אותו, הדשבורד ייטען ממנו לבד.',
        ),
      ),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          try {
            const res = await syncFromCloud({ force: true });
            toast(res.ok ? `נטען עדכון מהענן · ${timeAgo(Date.parse(res.updatedAt))}` : res.reason, res.ok ? 'ok' : 'bad');
            ui.rerender();
          } catch (err) { toast(err.message, 'bad'); }
        },
      }, '⟳ סנכרן מהענן עכשיו'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('docs') }, 'הוראות הגדרת 24/7 →'),
    ),
    notice('הדשבורד הציבורי הוא לקריאה בלבד: אין בו נתיב כתיבה לשרת, וכל שינוי שאתה עושה נשמר רק בדפדפן שלך. את המצב המשותף כותב רק ה־workflow שאתה מפעיל.', 'blue'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'נתונים וניהול מצב' }), h('div', { class: 'card-sub', text: 'ייצוא, ייבוא ואיפוס' }))),
    h('div', { class: 'row wrap', style: { gap: '8px' } },
      h('button', { class: 'btn btn-sm', onclick: () => downloadFile(`alta-state-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson(), 'application/json') }, '⬇ ייצוא מצב מלא'),
      h('button', { class: 'btn btn-sm', onclick: () => importFile.click() }, '⬆ ייבוא מצב'),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => openModal('מצב גולמי', h('pre', { class: 'code', text: store.exportJson().slice(0, 20000) }), { wide: true }),
      }, '👁 תצוגת JSON'),
      h('button', {
        class: 'btn btn-sm btn-danger',
        onclick: () => {
          if (confirm('לאפס את כל המצב? גרסאות, היסטוריה והגדרות יימחקו מהדפדפן הזה.')) {
            store.reset();
            toast('המצב אופס', '');
            ui.go('overview');
          }
        },
      }, 'אפס הכל'),
      importFile,
    ),
    h('div', { class: 'small muted', style: { marginTop: '10px' } },
      `מחזורים: ${store.state.stats.cycles || 0} · בקטסטים: ${store.state.stats.backtests || 0} · גרסאות: ${store.state.stats.deployments || 0} · סריקות: ${store.state.stats.scans || 0}`,
    ),
    notice(DISCLAIMER, 'bad'),
  ));

  // Debug log output - shows recent store events for debugging
  const events = store.state.events;
  const maxEvents = 50;
  const recentEvents = events.slice(0, maxEvents);
  const logPanel = h('div', { class: 'card alert-card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'לוגים ומסרים' }), h('div', { class: 'card-sub', text: 'אירועים אחרונים מהאפליקציה' })),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        style: { float: 'right' },
        onclick: () => {
          const current = logPanel.style.display;
          logPanel.style.display = current === 'none' ? 'block' : 'none';
        },
      }, 'הסתיר'),
    ),
    h('div', { class: 'card-body', style: { maxHeight: '300px', overflow: 'auto' } },
      recentEvents.length === 0
        ? h('div', { class: 'small muted' }, 'אין אירועים — הפעל מחזור כדי לייצר פעילות')
        : h('div', {}, recentEvents.map((e, i) =>
          h('div', { class: 'row', style: { gap: '4px', fontSize: '12px', marginBottom: '4px' } },
            h('span', { class: 'tiny muted', style: { width: '120px' }, text: new Date(e.at).toLocaleTimeString('he-IL') }),
            h('span', { class: 'grow', text: `[${e.level}] ${e.actor || '—'}: ${e.text || '—'}` }),
            h('span', { class: 'small muted', text: '' }),
          ),
        )),
    ),
  );
  mount(root, logPanel);

  // Agent thought bubbles panel - shows what agents are doing
  const agentActivities = generateAgentActivities(store.state);
  const activityPanel = h('div', { class: 'card thought-bubbles-card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'פעילות סוכנים' }), h('div', { class: 'card-sub', text: 'מה הסוכנים עושים כרגע' })),
      h('div', { class: 'card-foot', style: { background: 'var(--card-background, #1a1a2e)', padding: '8px' } },
        h('button', { class: 'btn btn-sm btn-ghost', style: { float: 'right' }, onclick: () => ui.rerender() }, 'רענון')
      ),
    ),
    h('div', { class: 'card-body', style: { maxHeight: '400px', overflow: 'auto' } },
      agentActivities.length === 0
        ? h('div', { class: 'small muted text-center py-8' }, 'אין פעילות סוכנים — הפעל אוטופיילוט או הרץ מחזור ידני')
        : h('div', {}, agentActivities.map((a, i) =>
          h('div', { class: 'thought-bubble', style: { borderColor: getBubbleColor(a.priority) }, key: i },
            h('div', { class: 'bubble-header' },
              h('span', { class: 'bubble-agent', text: a.agent }),
              h('span', { class: 'bubble-time', text: a.time })
            ),
            h('p', { class: 'bubble-text', text: a.summary }),
            h('small', { class: 'bubble-detail', text: a.detail }),
          ),
        )),
    ),
  );
  mount(root, activityPanel);
}

const ENV_HINT = {
  groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', zai: 'ZAI_API_KEY', openrouter: 'OPENROUTER_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID', mistral: 'MISTRAL_API_KEY', nvidia: 'NVIDIA_API_KEY',
  cohere: 'COHERE_API_KEY', xai: 'XAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', together: 'TOGETHER_API_KEY',
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gateway: 'LLM_GATEWAY_URL + LLM_GATEWAY_KEY', ollama: '—', webllm: '— (רץ בדפדפן)', custom: 'LLM_KEYS (JSON)',
};

const STATUS_LABEL = {
  ready: ['מוכן', 'green'], cooling: ['קירור', 'opt'], exhausted: ['נגמר היומי', 'dry'],
  throttled: ['מגבלת דקה', 'dry'], invalid: ['מפתח פסול', 'red'], disabled: ['מושבת', 'red'],
};

function webllmCard(ui) {
  const supported = webllm.isSupported();
  const st = webllm.state();
  const modelSel = h('select', {}, webllm.WEBLLM_MODELS.map((m) => h('option', { value: m.id, selected: m.id === (st.currentModel || webllm.WEBLLM_MODELS[0].id) }, `${m.label} (${m.size})`)));
  const statusEl = h('div', { class: 'small muted', text: supported
    ? (st.engine ? 'מודל טעון: ' + (st.currentModel || '') : 'לא טעון — לחץ "טען מודל" (הורדה חד-פעמית)')
    : 'הדפדפן לא תומך ב-WebGPU' });
  const progressEl = h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: (st.progress * 100).toFixed(0) + '%' } }));
  const loadBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    disabled: !supported || st.loading,
    onclick: async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'טוען...';
      const id = modelSel.value;
      try {
        await webllm.loadModel(id, ({ progress: p, text }) => {
          progressEl.querySelector('i').style.width = (p * 100).toFixed(0) + '%';
          statusEl.textContent = text || ('טוען ' + (p * 100).toFixed(0) + '%');
        });
        toast('מודל WebLLM טעון — inference ללא מגבלה', 'ok');
      } catch (err) {
        toast('טעינת מודל נכשלה: ' + err.message, 'bad');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'טען מודל';
        ui.rerender();
      }
    },
  }, 'טען מודל');
  const unloadBtn = h('button', {
    class: 'btn btn-sm btn-ghost',
    disabled: !st.engine,
    onclick: async () => { await webllm.unload(); toast('מודל שוחרר', ''); ui.rerender(); },
  }, 'שחרר');

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'מודל מקומי בדפדפן (WebLLM)' }),
        h('div', { class: 'card-sub', text: 'הרצה על ה-GPU של הדפדפן — ללא מפתח, ללא מגבלה, ללא רשת אחרי הורדה' })),
      tag(st.engine ? 'טעון' : (supported ? 'לא טעון' : 'לא נתמך'), st.engine ? 'live' : 'dry'),
    ),
    notice('זהו הפתרון ל"מודלים חינמיים ללא מגבלת API בדפדפן": המודל (1-3B) רץ על ה-GPU שלך דרך WebGPU. אחרי הורדה חד-פעמית (~0.7-2GB) אין קריאות רשת ואין rate limits. האיכות נמוכה ממודלים גדולים בענן, אבל זמינות היא 100%.', 'blue'),
    h('div', { class: 'form-grid', style: { marginTop: '10px' } },
      field('מודל', modelSel),
      h('div', { class: 'full' }, statusEl),
      h('div', { class: 'full' }, progressEl),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      loadBtn, unloadBtn,
      h('span', { class: 'tiny muted', text: supported ? 'Chrome/Edge 113+ או Safari עדכני' : 'נדרש דפדפן עם WebGPU' }),
    ),
    h('div', { class: 'small muted', style: { marginTop: '8px' } },
      'כשמודל טעון הוא מתווסף אוטומטית לרשימת המועמדים של היועץ ושל סמנכ״ל ההשקעות: קודם הבריכה בענן, ואם כולה נופלת — הדפדפן עצמו עונה. ' +
      'לריצה 24/7 ללא מגבלות בענן צריך GPU בשרת: הרץ Ollama על runner self-hosted והגדר LLM_BASE_URL=http://localhost:11434/v1.',
    ),
  );
}

function tradingviewCard(ui) {
  const pineBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const desk = store.state.desks.find((d) => d.version) || store.state.desks[0];
      if (!desk || !desk.version) { toast('אין גרסה מאושרת — הרץ מחזור קודם', 'bad'); return; }
      import('../platforms.js').then(({ buildArtifact }) => {
        const art = buildArtifact(desk, 'tradingview');
        downloadFile(art.filename, art.code, 'text/plain');
        toast('Pine Script הורד — הדבק ב-TradingView Pine Editor', 'ok');
      }).catch((e) => toast('שגיאה: ' + e.message, 'bad'));
    },
  }, 'ייצא Pine Script');

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'TradingView · paper trading' }),
        h('div', { class: 'card-sub', text: 'paper trading - no public order API' })),
      tag('paper only', 'dry'),
    ),
    notice('מגבלת כנות: ל-TradingView אין API פומבי לפקודות, ולכן אי אפשר "לחבר" את חשבון הנייר באופן אוטומטי. מה שכן אפשר: (1) לייצא את האסטרטגיה כ-Pine Script ולהריץ אותה על התרשים — TradingView עצמה תדמה כניסות ויציאות בחשבון הנייר, (2) לשלוח סיגנלים דרך Alerts → Webhook לשרת שלך, (3) לחבר broker לנייר עם API אמיתי (Alpaca/OKX demo) ולראות את התרשימים ב-TradingView.', 'bad'),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      pineBtn,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => {
        const cmd = 'TradingView Alert -> Webhook URL: https://your-endpoint/alta-signal\nPayload: {"symbol":"{{ticker}}","action":"{{strategy.order.action}}","price":"{{close}}"}';
        copyText(cmd);
      } }, 'העתק תבנית alert'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://www.tradingview.com/support/solutions/43000529348-how-to-set-up-a-webhook/', target: '_blank', rel: 'noopener', text: 'TradingView Webhook guide ↗' }),
    ),
    h('div', { class: 'small muted', style: { marginTop: '8px' } },
      'איך מריצים: בחר "TradingView (Pine Script)" כשפת הפלטפורמה, הרץ מחזורים עד שגרסה עוברת את ספי הקידום, ואז לחץ "ייצא Pine Script" והדבק ב-Pine Editor. הוסף לתרשים ולחץ "Add to chart" — מעכשיו TradingView מדמה כל כניסה ויציאה בחשבון הנייר שלה, בזמן אמת.',
    ),
  );
}

function proxyCard(ui) {
  const st = store.state.settings;
  const proxyUrl = h('input', { type: 'url', value: st.cloudflareProxyUrl || '', placeholder: 'https://<worker>.workers.dev/v1 או Cloudflare AI Gateway URL', dir: 'ltr' });
  const proxyKey = h('input', { type: 'password', value: st.cloudflareProxyKey || '', placeholder: 'מפתח/טוקן ל-Proxy (אם נדרש)', dir: 'ltr', autocomplete: 'off' });
  const modelIn = h('input', { type: 'text', value: st.cloudflareProxyModel || 'llama-3.1-8b-instant', placeholder: 'מודל דרך Proxy (למשל llama-3.1-8b-instant / @cf/meta/llama-3.3-70b-instruct-fp8-fast)', dir: 'ltr' });
  const addProxy = () => {
    const url = proxyUrl.value.trim();
    if (!url) { toast('הזן כתובת Proxy/Gateway', 'bad'); return; }
    const res = addPoolEntry(store.state, { provider: 'gateway', model: modelIn.value.trim() || 'auto', key: proxyKey.value.trim(), baseUrl: url, label: 'Cloudflare/AI Proxy' });
    store.mutate((x) => {
      x.settings.cloudflareProxyUrl = url;
      x.settings.cloudflareProxyKey = proxyKey.value.trim();
      x.settings.cloudflareProxyModel = modelIn.value.trim() || 'auto';
    });
    toast(res.duplicate ? 'ה-proxy כבר בבריכה' : 'Proxy נוסף לבריכה — הסוכנים ישתמשו בו', res.duplicate ? 'bad' : 'ok');
    ui.rerender();
  };
  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'Proxy / Cloudflare AI Gateway (Groq, Workers AI וכו׳)' }),
        h('div', { class: 'card-sub', text: 'חיבור מודלי AI חינמיים דרך Cloudflare Worker/Proxy — הסוכנים ינתבו אליו אוטומטית' })),
      tag('proxy', 'live'),
    ),
    notice('הגדר כאן כתובת Proxy תואמת OpenAI (/v1/chat/completions), למשל Cloudflare Worker שמעביר ל-Groq או ל-Cloudflare Workers AI ומחזיק את המפתח כסוד בצד השרת. לאחר הוספה הוא נכנס לבריכת המודלים והסוכנים משתמשים בו עם רוטציה ונפילה אוטומטית. ניתן גם להוסיף ישירות Groq/Cloudflare בבריכה למטה.', 'blue'),
    h('div', { class: 'form-grid', style: { marginTop: '12px' } },
      h('div', { class: 'full' }, field('כתובת Proxy/Gateway', proxyUrl)),
      field('מפתח ל-Proxy (אופציונלי)', proxyKey),
      field('מודל ברירת מחדל', modelIn),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', onclick: addProxy }, 'הוסף Proxy לבריכה'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://developers.cloudflare.com/ai-gateway/', target: '_blank', rel: 'noopener', text: 'Cloudflare AI Gateway ↗' }),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener', text: 'מפתח Groq ↗' }),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://developers.cloudflare.com/workers-ai/', target: '_blank', rel: 'noopener', text: 'Workers AI ↗' }),
    ),
    h('ul', { class: 'list-clean', style: { marginTop: '8px' } },
      h('li', { class: 'small muted', text: 'דוגמה ל-Worker: קבל POST ב-/v1/chat/completions והעבר ל-https://api.groq.com/openai/v1 עם Authorization מתוך סוד GROQ_API_KEY ב-Cloudflare.' }),
      h('li', { class: 'small muted', text: 'ל-24/7 ב-Actions: הוסף Secrets כמו GROQ_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID או LLM_GATEWAY_URL/KEY.' }),
    ),
  );
}

function poolCard(ui) {
  const now = Date.now();
  const stats = poolStats(store.state, now);
  const entries = poolEntries(store.state);

  const providerSel = h('select', {}, PROVIDER_ORDER.map((k) => h('option', {
    value: k,
    selected: k === 'groq',
  }, PROVIDERS[k].free ? `${PROVIDERS[k].label} · חינם` : PROVIDERS[k].label)));
  const modelIn = h('input', { type: 'text', list: 'pool-models', placeholder: 'בחר או הקלד שם מודל', dir: 'ltr' });
  const keyIn = h('input', { type: 'password', placeholder: 'מפתח API', dir: 'ltr', autocomplete: 'off' });
  const accountIn = h('input', { type: 'text', placeholder: 'Account ID (רק Cloudflare)', dir: 'ltr' });
  const baseIn = h('input', { type: 'url', placeholder: 'כתובת API (רק gateway/custom)', dir: 'ltr' });
  const datalist = h('datalist', { id: 'pool-models' }, PROVIDER_ORDER.flatMap((k) => (PROVIDERS[k].models || []).map((m) => h('option', { value: m }))));
  const cfBulk = h('textarea', {
    rows: '3',
    dir: 'ltr',
    placeholder: 'ACCOUNT_ID,TOKEN\nACCOUNT_ID,TOKEN,MODEL',
    style: { width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '12px' },
  });

  const add = () => {
    const provider = providerSel.value;
    const def = PROVIDERS[provider];
    if (provider === 'cloudflare' && !accountIn.value.trim()) {
      toast('ל-Cloudflare צריך גם Account ID', 'bad');
      return;
    }
    if (!keyIn.value.trim() && provider !== 'ollama' && provider !== 'webllm') {
      toast('חסר מפתח API', 'bad');
      return;
    }
    const res = addPoolEntry(store.state, {
      provider,
      model: modelIn.value.trim() || def.models?.[0] || '',
      key: keyIn.value.trim(),
      accountId: accountIn.value.trim(),
      baseUrl: baseIn.value.trim(),
    });
    if (res.duplicate) {
      toast('המפתח הזה כבר בבריכה', 'bad');
      return;
    }
    store.save(true);
    store.emit();
    toast(`${def.label} נוסף לבריכה ונשמר`, 'ok');
    ui.rerender();
  };

  const addBulk = () => {
    const list = parseCloudflareKeys(cfBulk.value);
    if (!list.length) {
      toast('לא זוהו חשבונות — כל שורה: ACCOUNT_ID,TOKEN', 'bad');
      return;
    }
    let added = 0;
    for (const item of list) {
      const res = addPoolEntry(store.state, { provider: 'cloudflare', accountId: item.accountId, key: item.key, model: item.model });
      if (!res.duplicate) added++;
    }
    store.save(true);
    store.emit();
    toast(`${added}/${list.length} חשבונות נוספו ונשמרו`, added ? 'ok' : 'bad');
    ui.rerender();
  };

  const rows = entries.map((entry, idx) => {
    const def = PROVIDERS[entry.provider] || { label: entry.provider };
    const status = entryStatus(entry, now);
    const [label, color] = STATUS_LABEL[status] || [status, 'dry'];
    const lim = limitsFor(entry);
    const cooling = entry.cooldownUntil > now ? Math.ceil((entry.cooldownUntil - now) / 1000) : 0;
    return h('div', { class: 'row', style: { gap: '10px', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.06)', alignItems: 'flex-start' } },
      h('div', { class: 'grow' },
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          h('b', { style: { fontSize: '13px' }, text: def.label }),
          tag(entry.model || '—', 'dry'),
          tag(label, color),
        ),
        h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: [
          entry.key ? '••••' + entry.key.slice(-4) : 'ללא מפתח',
          entry.accountId ? 'acct ' + entry.accountId.slice(0, 8) + '…' : null,
          `${entry.dayCount || 0}${lim.rpd ? '/' + lim.rpd : ''} בקשות היום`,
          cooling ? `קירור ${cooling}s` : null,
          entry.lastError ? entry.lastError.slice(0, 90) : null,
        ].filter(Boolean).join(' · ') }),
      ),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('button', {
          class: 'btn btn-sm',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = '…';
            const res = await testPoolEntry(entry.id);
            toast(res.ok ? `${def.label} ענה: ${res.reply}` : `${def.label}: ${res.error}`, res.ok ? 'ok' : 'bad');
            ui.rerender();
          },
        }, 'בדוק'),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => { entry.enabled = !entry.enabled; if (entry.enabled) { entry.valid = true; entry.cooldownUntil = 0; } store.save(true); store.emit(); ui.rerender(); },
        }, entry.enabled ? 'השבת' : 'הפעל'),
        h('button', { class: 'btn btn-sm btn-ghost', disabled: idx === 0, onclick: () => { movePoolEntry(store.state, entry.id, -1); store.save(true); ui.rerender(); } }, '▲'),
        h('button', { class: 'btn btn-sm btn-ghost', disabled: idx === entries.length - 1, onclick: () => { movePoolEntry(store.state, entry.id, 1); store.save(true); ui.rerender(); } }, '▼'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => { removePoolEntry(store.state, entry.id); store.save(true); store.emit(); ui.rerender(); } }, 'הסר'),
      ),
    );
  });

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'בריכת מודלים חינמיים' }),
        h('div', { class: 'card-sub', text: `${stats.total} מפתחות · ${stats.ready} מוכנים · ${stats.requestsToday} בקשות היום · ${stats.providers} ספקים` })),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag(stats.ready ? 'בריכה פעילה' : 'אין מפתחות זמינים', stats.ready ? 'live' : 'dry'),
      ),
    ),
    h('p', { class: 'small muted', style: { marginTop: '4px' } },
      'כל מפתח שנוסף כאן נכנס לתור אחד: הבקשה הולכת למפתח שהכי מזמן לא נוצל, 429 מכניס אותו לקירור מעריכי, 401 משבית אותו, ומגבלות ה-RPM/RPD של כל ספק נאכפות. כשספק נופל — הבקשה ממשיכה לספק הבא, כך שהסוכנים ממשיכים לעבוד גם כשמודל חינמי נגמר.',
    ),
    h('div', { class: 'form-grid', style: { marginTop: '12px' } },
      field('ספק', providerSel),
      field('מודל', h('div', {}, modelIn, datalist)),
      field('מפתח API', keyIn),
      field('Account ID', accountIn),
      h('div', { class: 'full' }, field('כתובת API (אופציונלי)', baseIn)),
      h('div', { class: 'full' }, field('Cloudflare — כמה חשבונות בבת אחת (ACCOUNT_ID,TOKEN בכל שורה)', cfBulk)),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } },
      h('button', { class: 'btn btn-sm', onclick: addBulk }, '+ הוסף חשבונות Cloudflare'),
      h('span', { class: 'tiny muted', text: 'לכל חשבון מכסה יומית נפרדת של 10,000 Neurons — הבריכה תסובב ביניהם.' }),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', onclick: add }, '+ הוסף לבריכה'),
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const all = poolEntries(store.state);
          if (!all.length) { toast('הבריכה ריקה', 'bad'); return; }
          let ok = 0;
          for (const entry of all) {
            const res = await testPoolEntry(entry.id);
            if (res.ok) ok++;
          }
          toast(`${ok}/${all.length} מפתחות ענו`, ok ? 'ok' : 'bad');
          ui.rerender();
        },
      }, 'בדוק את כולם'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { resetCooldowns(store.state); store.save(true); store.emit(); ui.rerender(); } }, 'אפס קירורים'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://github.com/open-free-llm-api/awesome-freellm-apis', target: '_blank', rel: 'noopener', text: 'רשימת הספקים החינמיים ↗' }),
    ),
    helpBlock(providerSel),
    rows.length ? h('div', { style: { marginTop: '8px' } }, rows) : h('div', { class: 'small muted', style: { marginTop: '10px' }, text: 'הבריכה ריקה. הוסף מפתח אחד ומעלה — Groq ו-Gemini הם ההתחלה המומלצת.' }),
    notice('בדפדפן המפתחות נשמרים מקומית בלבד. כדי שהסוכנים בענן ישתמשו בהם, הוסף אותם כסודות בריפו: ' +
      Object.values(ENV_HINT).filter((v) => v !== '—').slice(0, 8).join(' · ') + ' — הבריכה נבנית מהם אוטומטית.', 'blue'),
  );
}

function helpBlock(providerSel) {
  const keyLink = h('a', {
    class: 'btn btn-sm btn-ghost',
    href: PROVIDERS[providerSel.value]?.keyUrl || '#',
    target: '_blank',
    rel: 'noopener',
    text: keyLabel(providerSel.value),
  });
  const note = h('div', { class: 'small muted', text: PROVIDERS[providerSel.value]?.note || '' });
  const envName = h('code', { text: ENV_HINT[providerSel.value] || '—' });
  providerSel.addEventListener('change', () => {
    const p = providerSel.value;
    const def = PROVIDERS[p] || {};
    keyLink.href = def.keyUrl || '#';
    keyLink.textContent = keyLabel(p);
    note.textContent = def.note || '';
    envName.textContent = ENV_HINT[p] || '—';
  });

  const step = (title, body) => h('li', { style: { marginBottom: '10px' } },
    h('b', { style: { fontSize: '13px' }, text: title }),
    body,
  );

  return h('details', { style: { marginTop: '12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 12px' } },
    h('summary', { style: { cursor: 'pointer', fontSize: '13px' }, text: 'איך מחברים מודל — הוראות צעד אחר צעד' }),
    h('ol', { class: 'list-clean', style: { marginTop: '10px' } },
      step('1. הנפק מפתח אצל הספק', h('div', {},
        h('div', { class: 'small muted', text: 'בחר ספק למעלה ולחץ על הקישור. ההרשמה חינמית ולא דורשת כרטיס אשראי אצל Groq, Gemini, Z.ai, OpenRouter ו-Cloudflare.' }),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px' } }, keyLink),
        note,
      )),
      step('2. הוסף אותו לבריכה', h('div', { class: 'small muted' },
        'הדבק את המפתח בשדה "מפתח API", בחר מודל (אפשר להקליד ידנית), ולחץ "+ הוסף לבריכה". לחץ "בדוק" כדי לוודא שהמפתח עונה, ואם לא — השגיאה תופיע ליד השורה. מפתח אחד מספיק כדי להתחיל; כל מפתח נוסף מגדיל את התקרה היומית.',
      )),
      step('3. אותו מפתח לענן (24/7)', h('div', {},
        h('div', { class: 'small muted', text: 'הבוט שרץ ב-GitHub Actions לא רואה את הדפדפן. הוסף את המפתח כסוד בריפו בשם המדויק:' }),
        h('div', { class: 'row wrap', style: { gap: '6px', margin: '6px 0' } }, h('span', { class: 'small', text: 'שם הסוד:' }), envName),
        h('pre', { class: 'code', text: 'gh secret set GROQ_API_KEY' }),
        h('div', { class: 'small muted', text: 'או בדפדפן: Settings → Secrets and variables → Actions → New repository secret. שם הסוד חייב להיות בדיוק כמו בטבלה, אחרת הבריכה לא תזהה אותו.' }),
      )),
      step('4. בדוק שזה עבד', h('div', { class: 'small muted' },
        'הרץ את Firm loop ידנית וחפש בלוג את השורה model pool: … ואת answered by … ב-data/last-run.json. אם ספק נכשל תמיד תופיע שורת fallback from … עם הסיבה.',
      )),
    ),
    h('div', { style: { marginTop: '6px' } },
      h('div', { class: 'small', style: { marginBottom: '4px' }, text: 'רוצה רשימה מפורשת עם מודלים שונים לאותו ספק? השתמש בסוד אחד:' }),
      h('pre', { class: 'code', text: 'LLM_KEYS=[{"provider":"groq","key":"gsk_...","model":"llama-3.3-70b-versatile"},\n          {"provider":"cloudflare","key":"cf_...","accountId":"...","model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast"}]' }),
    ),
    h('ul', { class: 'list-clean', style: { marginTop: '8px' } },
      h('li', { class: 'small muted', text: 'הבריכה בוחרת את המפתח שהכי מזמן לא נוצל, מכבדת RPM/RPD, ומדלגת אוטומטית על מפתח בקירור או כזה שנגמרה לו המכסה היומית.' }),
      h('li', { class: 'small muted', text: 'ספקים כמו Groq ו-NVIDIA חוסמים קריאה ישירה מהדפדפן (CORS) — הבדיקה כאן תחזיר שגיאת רשת, אבל הריצה בענן תקינה. Gemini ו-OpenRouter עובדים גם כאן.' }),
      h('li', { class: 'small muted', text: 'כל המפתחות נשמרים מקומית בדפדפן הזה, וה-runner מנקה אותם מ-data/state.json לפני כל commit.' }),
    ),
  );
}

function keyLabel(providerId) {
  const def = PROVIDERS[providerId];
  if (!def?.keyUrl) return 'אין דף מפתחות לספק הזה';
  return `הנפק מפתח ${def.label} ↗`;
}

function field(label, input) {
  return h('label', { class: 'field' }, label, input);
}

function fun(text) {
  return h('div', { class: 'small muted', style: { marginTop: '10px' } }, text);
}

function getBubbleColor(priority) {
  const colors = { high: "var(--danger, #ff4757)", medium: "var(--warning, #ffa502)", low: "var(--info, #4ecdc4)" };
  return colors[priority] || colors.low;
}

function generateAgentActivities(state) {
  const agents = ["אוריה · CIO", "נועה · אופטימיזציה", "דניאל · סיכונים", "תמר · ביצוע", "ליה · ניתוח"];
  const now = Date.now();
  const activities = [];
  // Get recent events and group by agent
  const recentEvents = state.events.slice(0, 30);
  const agentEvents = {};
  for (const event of recentEvents) {
    if (event.actor && !agentEvents[event.actor]) {
      agentEvents[event.actor] = [];
    }
    if (event.actor) {
      agentEvents[event.actor].push(event);
    }
  }
  // Generate activity summary for each agent
  for (const agent of agents) {
    const events = agentEvents[agent] || [];
    const lastEvent = events[0];
    let summary = "מחכה לפעילות";
    let detail = "";
    let priority = "low";
    if (lastEvent) {
      summary = lastEvent.text.slice(0, 40) + (lastEvent.text.length > 40 ? "…" : "");
      detail = `מאת ${lastEvent.at ? new Date(lastEvent.at).toLocaleTimeString("he-IL") : "לא ידוע"}`;
      if (lastEvent.level === "ok") priority = "low";
      else if (lastEvent.level === "warn") priority = "medium";
      else if (lastEvent.level === "bad") priority = "high";
    }
    activities.push({ agent, summary, detail, priority });
  }
  // Also add system-level activities
  if (state.desks && state.desks.length > 0) {
    const activeDesk = state.desks.find((d) => d.version) || state.desks[0];
    activities.unshift({
      agent: "מערכת",
      summary: activeDesk ? `גרסת ${activeDesk.label}` : "אין גרסה פעילה",
      detail: activeDesk ? `סימון: ${activeDesk.symbol} · ${activeDesk.tf}` : "אין הגדרות",
      priority: "medium"
    });
  }
  return activities;
}
