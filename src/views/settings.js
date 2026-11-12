import { mount } from '../ui.js';
import { store } from '../store.js';
import { LLM_PROVIDERS, PLATFORMS, DISCLAIMER } from '../config.js';
import { testConnection } from '../llm.js';
import { h, notice, toast, openModal, downloadFile, timeAgo, tag } from '../ui.js';
import { syncFromCloud } from '../remote.js';

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
        h('button', { class: 'btn btn-primary', onclick: save }, 'שמור הגדרות'),
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

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'מודל AI' }), h('div', { class: 'card-sub', text: 'OpenAI-compatible, Anthropic או Gemini' }))),
      h('div', { class: 'form-grid' },
        field('ספק', provider),
        field('שם מודל', model),
        field('כתובת API', baseUrl),
        field('טמפרטורה', temperature),
        h('div', { class: 'full' }, field('מפתח API (נשמר מקומית)', keyInput)),
      ),
      notice('ספקים שחוסמים בקשות דפדפן (CORS) לא יעבדו ישירות מהאתר. במצב כזה אפשר להריץ פרוקסי מקומי, או להשתמש ב-OpenRouter/Groq/Gemini שתומכים בקריאה מהדפדפן.', 'blue'),
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
}

function field(label, input) {
  return h('label', { class: 'field' }, label, input);
}

function fun(text) {
  return h('div', { class: 'small muted', style: { marginTop: '10px' } }, text);
}
