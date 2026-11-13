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
      store.log('info', 'נ�"��"�S', '����ר�"ת ע�"��:נ�"');
    });
    toast('����ר�"ת נש�~ר�"', 'ok');
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
        toast('��~צ� נ��ע�x �~�ק�"�ץ', 'ok');
        ui.go('overview');
      } catch (err) {
        toast('��ע�"נ� נ�:ש�S�: ' + err.message, 'bad');
      }
    },
  });

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Control room' }),
        h('h1', { text: '���ר�"ת �"�~פת��"ת' }),
        h('p', { text: '�:א�x �~��ר�"ם �~�"��S, �~���"ר�"ם ס�"�:�"�x, ��"�ר�"ם פ�S��פ�"ר�~ת ��"�� �"�~��ר�"ם את ��"�:ר�"�x ���ר� �Sר�"פ�" GitHub.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary', onclick: save }, 'ש�~�"ר ��:�S'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            save();
            try { const r = await testConnection(); toast('��~�"��S ענ�: ' + r, 'ok'); }
            catch (err) { toast('�:ש�S ���"��"ר: ' + err.message, 'bad'); }
          },
        }, 'ש�~�"ר �"���"ק �~�"��S'),
      ),
    ),
    notice('��~פת��"ת נש�~ר�"ם �-localStorage ש�S ��פ�פ�x ��� ��S��. א�"�x שרת, א�"�x �ס�"ס נת�"נ�"ם �"א�"�x ש�S�"�ת �~פת��"ת �Sש�"ם �~ק�"ם �~�S�� ספק ��~�"��S. א�S תע�S� ק�"�ץ ���ר�"ת עם �~פת��"ת �Sר�"פ�" צ�"��"ר�".', 'bad'),
  );

  mount(root, poolCard(ui));
  mount(root, proxyCard(ui));
  mount(root, webllmCard(ui));
  mount(root, tradingviewCard(ui));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: '�~�"��S AI ראש�"' }), h('div', { class: 'card-sub', text: '�ר�"רת �~���S / פר�"קס�" � ��ר�"�:� �~ע�S�"�" ק�"��~ת' }))),
      h('div', { class: 'form-grid' },
        field('ספק', provider),
        field('שם �~�"��S', model),
        field('�:ת�"�ת API', baseUrl),
        field('���~פר���"ר�', temperature),
        h('div', { class: 'full' }, field('�~פת� API (נש�~ר �~ק�"�~�"ת)', keyInput)),
      ),
      notice('ספק�"ם ש��"ס�~�"ם �קש�"ת �פ�פ�x (CORS) �Sא �"ע���" �"ש�"ר�"ת �~�אתר. ��~צ� �:�� אפשר �S�ר�"ץ פר�"קס�" �~ק�"�~�", א�" �S�שת�~ש �-OpenRouter/Groq/Gemini שת�"�~�:�"ם �קר�"א� �~��פ�פ�x.', 'blue'),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'ש�~�"ר ���ר�"ת API'),
        h('button', { class: 'btn btn-sm', onclick: async () => { save(); try { const r = await testConnection(); toast('��~�"��S ענ�: ' + r, 'ok'); } catch (err) { toast('�:ש�S ���"��"ר: ' + err.message, 'bad'); } } }, 'ש�~�"ר �"���"ק ��"��"ר'),
      ),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'ס�"�:�"�x �"�פע�S�' }), h('div', { class: 'card-sub', text: 'שער�" �ק�"��"ם �"�קצאת ���"�x' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, h('label', { class: 'check' }, autopilot, 'א�"���"פ�"�"�S�"�� � �ס�"�:נ�"ם רצ�"ם �S�� �:�S �:�~� שנ�"�"ת')),
        field('שנ�"�"ת ��"�x �~���"ר�"ם', tickSeconds),
        field('×”×•×Ÿ ×ž×“×•×ž×” ($)', capital),
        field('ס�"�:�"�x �Sעסק� (%)', risk),
        field('Max DD (%)', maxDd),
        field('�~�"נ�"�~�"ם עסקא�"ת', minTrades),
        field('Profit Factor �~�"נ�"�~�S�"', minPf),
        field('��"ס�x ס�����"ס���" �~�"נ�"�~�S�" (0-100)', minRobust),
        field('סף ש�"פ�"ר �S�רס� (%)', delta),
        h('div', { class: 'full' }, field('פ�S��פ�"ר�~ת �"ע� �Sק�"�', platform)),
      ),
      h('div', { class: 'small muted', style: { marginTop: '8px' } },
        '�סף ק�"�ע �~ת�" נפת�ת �רס� ��ש�: ש�"פ�"ר ש�S ' + s.promotionDelta + '% �"�~ע�S� �-OOS, �תנא�" ש��~���"ם ע�"�ר�"ם את שער�" �ס�"�:�"�x.',
      ),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: '��"�:ר�"�x ���ר� �-GitHub' }), h('div', { class: 'card-sub', text: 'Contents API · ���"ק�x fine-grained עם contents:write' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, field('���"ק�x GitHub', ghToken)),
        field('Owner', ghOwner),
        field('Repository', ghRepo),
        h('div', { class: 'full' }, field('נת�"� �ק�"�ץ �ר�"פ�"', ghPath)),
      ),
      fun('אפשר �Sש�~�"ר את �ק�"נ��קס�� (פר�~��ר�"ם, �~���"ם, רע�"�"נ�"ת) ��:�S �~���"ר א�" �"�נ�"ת �~�~ס�a ��~�קר.'),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: '��ש�"ת �"רשת�"ת' }), h('div', { class: 'card-sub', text: 'endpoint ש�~���"ר JSON עם articles/items/data' }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, field('�:ת�"�ת endpoint', newsEndpoint)),
        h('div', { class: 'full' }, field('�~פת� (א�"פצ�"�"נ�S�")', newsKey)),
      ),
      fun('��"��~�: NewsAPI � https://newsapi.org/v2/everything?q=bitcoin&language=he. אפשר �ם RSS-to-JSON. Reddit �"-Fear & Greed ע�"���"ם �S�Sא �~פת�.'),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: '�רצ� 24/7 �ענ�x' }), h('div', { class: 'card-sub', text: 'GitHub Actions �:�"ת� data/state.json �"��ש��"ר� ק�"רא �~שם' })),
      store.state.remote?.updatedAt ? tag('ענ�x �~��"�ר', 'live') : tag('�~ק�"�~�" ��S��', 'dry'),
    ),
    h('div', { class: 'form-grid' },
      h('div', { class: 'full' }, h('label', { class: 'check' }, cloudSync, '��ע�x �~צ� �~�ענ�x א�"���"�~���"ת (�~�:�� א�"���"פ�"�"�S�"�� �~ק�"�~�" �:��" ש�Sא �"ר�"צ�" שנ�" �~נ�"ע�"ם)')),
      h('div', { class: 'full' },
        h('div', { class: 'small muted' },
          store.state.remote?.updatedAt
            ? `ע��:�"�x א�ר�"�x �~�ענ�x: ${new Date(store.state.remote.updatedAt).toLocaleString('he-IL')} · ${store.state.remote.cycles || 0} �~���"ר�"ם · �~ק�"ר ${store.state.remote.source}`
            : '�Sא נ�~צא data/state.json. א�ר�" ש�־runner �ראש�"�x �"���"ף א�"ת�", ��ש��"ר� �"�"��ע�x �~�~נ�" �S��.',
        ),
      ),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          try {
            const res = await syncFromCloud({ force: true });
            toast(res.ok ? `נ��ע�x ע��:�"�x �~�ענ�x · ${timeAgo(Date.parse(res.updatedAt))}` : res.reason, res.ok ? 'ok' : 'bad');
            ui.rerender();
          } catch (err) { toast(err.message, 'bad'); }
        },
      }, '�x� סנ�:ר�x �~�ענ�x ע�:ש�"�"'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('docs') }, '��"רא�"ת ���רת 24/7 � '),
    ),
    notice('��ש��"ר� �צ�"��"ר�" ��"א �Sקר�"א� ��S��: א�"�x ��" נת�"� �:ת�"�� �Sשרת, �"�:�S ש�"נ�"�" שאת� ע�"ש� נש�~ר רק ��פ�פ�x ש�S�a. את ��~צ� ��~ש�"תף �:�"ת� רק �־workflow שאת� �~פע�"�S.', 'blue'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'נת�"נ�"ם �"נ�"��"�S �~צ�' }), h('div', { class: 'card-sub', text: '�"�"צ�"א, �"�"��"א �"א�"פ�"ס' }))),
    h('div', { class: 'row wrap', style: { gap: '8px' } },
      h('button', { class: 'btn btn-sm', onclick: () => downloadFile(`alta-state-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson(), 'application/json') }, '�! �"�"צ�"א �~צ� �~�Sא'),
      h('button', { class: 'btn btn-sm', onclick: () => importFile.click() }, '�  �"�"��"א �~צ�'),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => openModal('�~צ� ��"�S�~�"', h('pre', { class: 'code', text: store.exportJson().slice(0, 20000) }), { wide: true }),
      }, '�x� תצ�"�ת JSON'),
      h('button', {
        class: 'btn btn-sm btn-danger',
        onclick: () => {
          if (confirm('�Sאפס את �:�S ��~צ�? �רסא�"ת, ��"ס���"ר�"� �"���ר�"ת �"�"�~�ק�" �~��פ�פ�x ���.')) {
            store.reset();
            toast('��~צ� א�"פס', '');
            ui.go('overview');
          }
        },
      }, 'אפס ��:�S'),
      importFile,
    ),
    h('div', { class: 'small muted', style: { marginTop: '10px' } },
      `�~���"ר�"ם: ${store.state.stats.cycles || 0} · �ק��ס���"ם: ${store.state.stats.backtests || 0} · �רסא�"ת: ${store.state.stats.deployments || 0} · סר�"ק�"ת: ${store.state.stats.scans || 0}`,
    ),
    notice(DISCLAIMER, 'bad'),
  ));

  // Debug log output - shows recent store events for debugging
  const events = store.state.events;
  const maxEvents = 50;
  const recentEvents = events.slice(0, maxEvents);
  const logPanel = h('div', { class: 'card alert-card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: '�S�"��"ם �"�~סר�"ם' }), h('div', { class: 'card-sub', text: 'א�"ר�"ע�"ם א�ר�"נ�"ם �~�אפ�S�"קצ�"�' })),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        style: { float: 'right' },
        onclick: () => {
          const current = logPanel.style.display;
          logPanel.style.display = current === 'none' ? 'block' : 'none';
        },
      }, '�סת�"ר'),
    ),
    h('div', { class: 'card-body', style: { maxHeight: '300px', overflow: 'auto' } },
      recentEvents.length === 0
        ? h('div', { class: 'small muted' }, 'א�"�x א�"ר�"ע�"ם � �פע�S �~���"ר �:��" �S�"�"צר פע�"�S�"ת')
        : h('div', {}, recentEvents.map((e, i) =>
          h('div', { class: 'row', style: { gap: '4px', fontSize: '12px', marginBottom: '4px' } },
            h('span', { class: 'tiny muted', style: { width: '120px' }, text: new Date(e.at).toLocaleTimeString('he-IL') }),
            h('span', { class: 'grow', text: `[${e.level}] ${e.actor || 'â€”'}: ${e.text || 'â€”'}` }),
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
      h('div', {}, h('h2', { text: 'פע�"�S�"ת ס�"�:נ�"ם' }), h('div', { class: 'card-sub', text: '�~� �ס�"�:נ�"ם ע�"ש�"ם �:ר�ע' })),
      h('div', { class: 'card-foot', style: { background: 'var(--card-background, #1a1a2e)', padding: '8px' } },
        h('button', { class: 'btn btn-sm btn-ghost', style: { float: 'right' }, onclick: () => ui.rerender() }, 'רענ�"�x')
      ),
    ),
    h('div', { class: 'card-body', style: { maxHeight: '400px', overflow: 'auto' } },
      agentActivities.length === 0
        ? h('div', { class: 'small muted text-center py-8' }, 'א�"�x פע�"�S�"ת ס�"�:נ�"ם � �פע�S א�"���"פ�"�"�S�"�� א�" �רץ �~���"ר �"�נ�"')
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
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gateway: 'LLM_GATEWAY_URL + LLM_GATEWAY_KEY', ollama: 'â€”', webllm: '� (רץ ��פ�פ�x)', custom: 'LLM_KEYS (JSON)',
};

const STATUS_LABEL = {
  ready: ['×ž×•×›×Ÿ', 'green'], cooling: ['ק�"ר�"ר', 'opt'], exhausted: ['נ��~ר ��"�"�~�"', 'dry'],
  throttled: ['�~���Sת �ק�', 'dry'], invalid: ['�~פת� פס�"�S', 'red'], disabled: ['�~�"ש�ת', 'red'],
};

function webllmCard(ui) {
  const supported = webllm.isSupported();
  const st = webllm.state();
  const modelSel = h('select', {}, webllm.WEBLLM_MODELS.map((m) => h('option', { value: m.id, selected: m.id === (st.currentModel || webllm.WEBLLM_MODELS[0].id) }, `${m.label} (${m.size})`)));
  const statusEl = h('div', { class: 'small muted', text: supported
    ? (st.engine ? '�~�"��S ��ע�"�x: ' + (st.currentModel || '') : '�Sא ��ע�"�x � �S�ץ "��ע�x �~�"��S" (��"ר�� ��-פע�~�"ת)')
    : '��פ�פ�x �Sא ת�"�~�a �-WebGPU' });
  const progressEl = h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: (st.progress * 100).toFixed(0) + '%' } }));
  const loadBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    disabled: !supported || st.loading,
    onclick: async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = '���"ע�x...';
      const id = modelSel.value;
      try {
        await webllm.loadModel(id, ({ progress: p, text }) => {
          progressEl.querySelector('i').style.width = (p * 100).toFixed(0) + '%';
          statusEl.textContent = text || ('���"ע�x ' + (p * 100).toFixed(0) + '%');
        });
        toast('�~�"��S WebLLM ��ע�"�x � inference �S�Sא �~���S�', 'ok');
      } catch (err) {
        toast('��ע�"נת �~�"��S נ�:ש�S�: ' + err.message, 'bad');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = '��ע�x �~�"��S';
        ui.rerender();
      }
    },
  }, '��ע�x �~�"��S');
  const unloadBtn = h('button', {
    class: 'btn btn-sm btn-ghost',
    disabled: !st.engine,
    onclick: async () => { await webllm.unload(); toast('�~�"��S ש�"�רר', ''); ui.rerender(); },
  }, 'ש�רר');

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: '�~�"��S �~ק�"�~�" ��פ�פ�x (WebLLM)' }),
        h('div', { class: 'card-sub', text: '�רצ� ע�S �-GPU ש�S ��פ�פ�x � �S�Sא �~פת�, �S�Sא �~���S�, �S�Sא רשת א�ר�" ��"ר��' })),
      tag(st.engine ? '��ע�"�x' : (supported ? '�Sא ��ע�"�x' : '�Sא נת�~�a'), st.engine ? 'live' : 'dry'),
    ),
    notice('���" �פתר�"�x �S"�~�"��S�"ם ��"נ�~�"�"ם �S�Sא �~���Sת API ��פ�פ�x": ��~�"��S (1-3B) רץ ע�S �-GPU ש�S�a �ר�a WebGPU. א�ר�" ��"ר�� ��-פע�~�"ת (~0.7-2GB) א�"�x קר�"א�"ת רשת �"א�"�x rate limits. �א�"�:�"ת נ�~�"�:� �~�~�"��S�"ם ���"�S�"ם �ענ�x, א��S ��~�"נ�"ת ��"א 100%.', 'blue'),
    h('div', { class: 'form-grid', style: { marginTop: '10px' } },
      field('×ž×•×“×œ', modelSel),
      h('div', { class: 'full' }, statusEl),
      h('div', { class: 'full' }, progressEl),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      loadBtn, unloadBtn,
      h('span', { class: 'tiny muted', text: supported ? 'Chrome/Edge 113+ א�" Safari ע��:נ�"' : 'נ�רש �פ�פ�x עם WebGPU' }),
    ),
    h('div', { class: 'small muted', style: { marginTop: '8px' } },
      '�:ש�~�"��S ��ע�"�x ��"א �~ת�"�"סף א�"���"�~���"ת �Sרש�"�~ת ��~�"ע�~��"ם ש�S ��"�"עץ �"ש�S ס�~נ�:״�S ��שקע�"ת: ק�"�ם ��ר�"�:� �ענ�x, �"אם �:�"�S� נ�"פ�Sת � ��פ�פ�x עצ�~�" ע�"נ�. ' +
      '�Sר�"צ� 24/7 �S�Sא �~���S�"ת �ענ�x צר�"�a GPU �שרת: �רץ Ollama ע�S runner self-hosted �"���ר LLM_BASE_URL=http://localhost:11434/v1.',
    ),
  );
}

function tradingviewCard(ui) {
  const pineBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const desk = store.state.desks.find((d) => d.version) || store.state.desks[0];
      if (!desk || !desk.version) { toast('א�"�x �רס� �~א�"שרת � �רץ �~���"ר ק�"�ם', 'bad'); return; }
      import('../platforms.js').then(({ buildArtifact }) => {
        const art = buildArtifact(desk, 'tradingview');
        downloadFile(art.filename, art.code, 'text/plain');
        toast('Pine Script ��"ר� � ���ק �-TradingView Pine Editor', 'ok');
      }).catch((e) => toast('ש��"א�: ' + e.message, 'bad'));
    },
  }, '�"�"צא Pine Script');

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'TradingView Â· paper trading' }),
        h('div', { class: 'card-sub', text: 'paper trading - no public order API' })),
      tag('paper only', 'dry'),
    ),
    notice('�~���Sת �:נ�"ת: �S-TradingView א�"�x API פ�"�~��" �Sפק�"��"ת, �"�S�:�x א�" אפשר "�S��ר" את �ש��"�x �נ�"�"ר �א�"פ�x א�"���"�~���". �~� ש�:�x אפשר: (1) �S�"�"צא את �אס��ר����"� �:-Pine Script �"�S�ר�"ץ א�"ת� ע�S �תרש�"ם � TradingView עצ�~� ת��~� �:נ�"ס�"ת �"�"צ�"א�"ת ��ש��"�x �נ�"�"ר, (2) �Sש�S�"� ס�"�נ�S�"ם �ר�a Alerts �  Webhook �Sשרת ש�S�a, (3) �S��ר broker �Sנ�"�"ר עם API א�~�"ת�" (Alpaca/OKX demo) �"�Sרא�"ת את �תרש�"�~�"ם �-TradingView.', 'bad'),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      pineBtn,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => {
        const cmd = 'TradingView Alert -> Webhook URL: https://your-endpoint/alta-signal\nPayload: {"symbol":"{{ticker}}","action":"{{strategy.order.action}}","price":"{{close}}"}';
        copyText(cmd);
      } }, '�עתק ת�נ�"ת alert'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://www.tradingview.com/support/solutions/43000529348-how-to-set-up-a-webhook/', target: '_blank', rel: 'noopener', text: 'TradingView Webhook guide â†—' }),
    ),
    h('div', { class: 'small muted', style: { marginTop: '8px' } },
      'א�"�a �~ר�"צ�"ם: ��ר "TradingView (Pine Script)" �:שפת �פ�S��פ�"ר�~�, �רץ �~���"ר�"ם ע� ש�רס� ע�"�רת את ספ�" �ק�"��"ם, �"א� �S�ץ "�"�"צא Pine Script" �"���ק �-Pine Editor. ��"סף �Sתרש�"ם �"�S�ץ "Add to chart" � �~ע�:ש�"�" TradingView �~��~� �:�S �:נ�"ס� �"�"צ�"א� ��ש��"�x �נ�"�"ר ש�S�, ���~�x א�~ת.',
    ),
  );
}

function proxyCard(ui) {
  const st = store.state.settings;
  const proxyUrl = h('input', { type: 'url', value: st.cloudflareProxyUrl || '', placeholder: 'https://<worker>.workers.dev/chat (�:�~�" gefen-ai-app) א�" /v1/chat/completions', dir: 'ltr' });
  const proxyKey = h('input', { type: 'password', value: st.cloudflareProxyKey || '', placeholder: '�~פת�/���"ק�x �S-Proxy (א�"פצ�"�"נ�S�", אם �-Worker ��"רש)', dir: 'ltr', autocomplete: 'off' });
  const modelIn = h('input', { type: 'text', value: st.cloudflareProxyModel || 'openai/gpt-oss-120b', placeholder: '�~�"��S �ר�a Proxy (�S�~ש�S openai/gpt-oss-120b / llama-3.1-8b-instant)', dir: 'ltr' });
  const addProxy = () => {
    const url = proxyUrl.value.trim();
    if (!url) { toast('���x �:ת�"�ת Proxy/Gateway', 'bad'); return; }
    const model = modelIn.value.trim() || 'openai/gpt-oss-120b';
    const key = proxyKey.value.trim();
    const res = addPoolEntry(store.state, { provider: 'gateway', model, key, baseUrl: url, label: 'Cloudflare/Groq Proxy' });
    store.mutate((x) => {
      x.settings.cloudflareProxyUrl = url;
      x.settings.cloudflareProxyKey = key;
      x.settings.cloudflareProxyModel = model;
    });
    toast(res.duplicate ? '�-proxy �:�ר ��ר�"�:�' : 'Proxy נ�"סף �S�ר�"�:� � �ס�"�:נ�"ם �"שת�~ש�" ��"', res.duplicate ? 'bad' : 'ok');
    ui.rerender();
  };
  const preset = (url, model) => {
    proxyUrl.value = url;
    modelIn.value = model;
    addProxy();
  };
  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'Cloudflare Proxy (Groq) â€” ×›×ž×• ×‘-gefen-ai-app' }),
        h('div', { class: 'card-sub', text: '��"��"ר �ש��"נ�"ת/Workers ש�S Cloudflare �ר�a Proxy ת�"אם, �Sש�"�~�"ש �צ�"�"ת �"�ס�"�:נ�"ם' })),
      tag('proxy', 'live'),
    ),
    notice('���ר �:א�x �:ת�"�ת Worker ש�S Cloudflare ש�~���"ק את GROQ_API_KEY �:ס�"� �"�~ק��S POST �-/chat (���"�"ק �:�~�" ���"��~� ש�S gefen-ai-app), א�" endpoint ת�"אם OpenAI �-/v1/chat/completions. �Sא�ר ��"ספ� ��"א נ�:נס �S�ר�"�:ת ��~�"��S�"ם �"�ס�"�:נ�"ם �~שת�~ש�"ם ��" א�"���"�~���"ת עם ר�"��צ�"� �"נפ�"�S�.', 'blue'),
    h('div', { class: 'form-grid', style: { marginTop: '12px' } },
      h('div', { class: 'full' }, field('�:ת�"�ת Proxy/Worker', proxyUrl)),
      field('�~פת� �S-Proxy (א�"פצ�"�"נ�S�")', proxyKey),
      field('�~�"��S �ר�"רת �~���S', modelIn),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', onclick: addProxy }, '��"סף Proxy �S�ר�"�:�'),
      h('button', { class: 'btn btn-sm', onclick: () => preset('https://gefen-proxy.kkar1953.workers.dev/chat', 'openai/gpt-oss-120b') }, '��"סף gefen-proxy'),
      h('button', { class: 'btn btn-sm', onclick: () => preset('https://shaked-proxy.kkar1953.workers.dev/chat', 'openai/gpt-oss-120b') }, '��"סף shaked-proxy'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener', text: '�~פת� Groq � ' }),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://dash.cloudflare.com/', target: '_blank', rel: 'noopener', text: 'Cloudflare Workers â†—' }),
    ),
    h('ul', { class: 'list-clean', style: { marginTop: '8px' } },
      h('li', { class: 'small muted', text: 'ת�נ�"ת Worker (�:�~�" �-gefen-ai-app): POST �S-https://<worker>.workers.dev/chat, ס�"� GROQ_API_KEY �-Workers, ALLOWED_ORIGIN �Sאתר, �~�"��S�"ם �~�"רש�"ם �"�~���S�"ת ���"קנ�"ם/��"�ע�"ת.' }),
      h('li', { class: 'small muted', text: '��פ�פ�x ��"�:נס �S���ר�"ת � � Proxy/Groq �"�S�ץ "��"סף gefen-proxy"/"��"סף shaked-proxy" א�" ���ק �:ת�"�ת Worker �~ש�S�a �:��" ש�צ�"�"ת �"שת�~ש ��".' }),
      h('li', { class: 'small muted', text: '�S-24/7 �-Actions אפשר �ם �S��"ס�"ף Secrets �:�~�" GROQ_API_KEY א�" LLM_GATEWAY_URL/KEY �S�"צ�"רת �ר�"�:ת �~�"��S�"ם א�"���"�~���"ת �ענ�x.' }),
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
  }, PROVIDERS[k].free ? `${PROVIDERS[k].label} · ��"נם` : PROVIDERS[k].label)));
  const modelIn = h('input', { type: 'text', list: 'pool-models', placeholder: '��ר א�" �ק�S� שם �~�"��S', dir: 'ltr' });
  const keyIn = h('input', { type: 'password', placeholder: '�~פת� API', dir: 'ltr', autocomplete: 'off' });
  const accountIn = h('input', { type: 'text', placeholder: 'Account ID (רק Cloudflare)', dir: 'ltr' });
  const baseIn = h('input', { type: 'url', placeholder: '�:ת�"�ת API (רק gateway/custom)', dir: 'ltr' });
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
      toast('�S-Cloudflare צר�"�a �ם Account ID', 'bad');
      return;
    }
    if (!keyIn.value.trim() && provider !== 'ollama' && provider !== 'webllm') {
      toast('�סר �~פת� API', 'bad');
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
      toast('��~פת� ��� �:�ר ��ר�"�:�', 'bad');
      return;
    }
    store.save(true);
    store.emit();
    toast(`${def.label} נ�"סף �S�ר�"�:� �"נש�~ר`, 'ok');
    ui.rerender();
  };

  const addBulk = () => {
    const list = parseCloudflareKeys(cfBulk.value);
    if (!list.length) {
      toast('�Sא ��"��" �ש��"נ�"ת � �:�S ש�"ר�: ACCOUNT_ID,TOKEN', 'bad');
      return;
    }
    let added = 0;
    for (const item of list) {
      const res = addPoolEntry(store.state, { provider: 'cloudflare', accountId: item.accountId, key: item.key, model: item.model });
      if (!res.duplicate) added++;
    }
    store.save(true);
    store.emit();
    toast(`${added}/${list.length} �ש��"נ�"ת נ�"ספ�" �"נש�~ר�"`, added ? 'ok' : 'bad');
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
          tag(entry.model || 'â€”', 'dry'),
          tag(label, color),
        ),
        h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: [
          entry.key ? 'â€¢â€¢â€¢â€¢' + entry.key.slice(-4) : '�S�Sא �~פת�',
          entry.accountId ? 'acct ' + entry.accountId.slice(0, 8) + 'â€¦' : null,
          `${entry.dayCount || 0}${lim.rpd ? '/' + lim.rpd : ''} �קש�"ת ��"�"ם`,
          cooling ? `ק�"ר�"ר ${cooling}s` : null,
          entry.lastError ? entry.lastError.slice(0, 90) : null,
        ].filter(Boolean).join(' Â· ') }),
      ),
      h('div', { class: 'row', style: { gap: '4px' } },
        h('button', {
          class: 'btn btn-sm',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'â€¦';
            const res = await testPoolEntry(entry.id);
            toast(res.ok ? `${def.label} ענ�: ${res.reply}` : `${def.label}: ${res.error}`, res.ok ? 'ok' : 'bad');
            ui.rerender();
          },
        }, '���"ק'),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => { entry.enabled = !entry.enabled; if (entry.enabled) { entry.valid = true; entry.cooldownUntil = 0; } store.save(true); store.emit(); ui.rerender(); },
        }, entry.enabled ? '�ש�ת' : '�פע�S'),
        h('button', { class: 'btn btn-sm btn-ghost', disabled: idx === 0, onclick: () => { movePoolEntry(store.state, entry.id, -1); store.save(true); ui.rerender(); } }, 'â–²'),
        h('button', { class: 'btn btn-sm btn-ghost', disabled: idx === entries.length - 1, onclick: () => { movePoolEntry(store.state, entry.id, 1); store.save(true); ui.rerender(); } }, 'â–¼'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => { removePoolEntry(store.state, entry.id); store.save(true); store.emit(); ui.rerender(); } }, '�סר'),
      ),
    );
  });

  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: '�ר�"�:ת �~�"��S�"ם ��"נ�~�"�"ם' }),
        h('div', { class: 'card-sub', text: `${stats.total} �~פת��"ת · ${stats.ready} �~�"�:נ�"ם · ${stats.requestsToday} �קש�"ת ��"�"ם · ${stats.providers} ספק�"ם` })),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag(stats.ready ? '�ר�"�:� פע�"�S�' : 'א�"�x �~פת��"ת ��~�"נ�"ם', stats.ready ? 'live' : 'dry'),
      ),
    ),
    h('p', { class: 'small muted', style: { marginTop: '4px' } },
      '�:�S �~פת� שנ�"סף �:א�x נ�:נס �Sת�"ר א��: ��קש� ��"�S�:ת �S�~פת� ש��:�" �~��~�x �Sא נ�"צ�S, 429 �~�:נ�"ס א�"ת�" �Sק�"ר�"ר �~ער�"�:�", 401 �~ש��"ת א�"ת�", �"�~���S�"ת �-RPM/RPD ש�S �:�S ספק נא�:פ�"ת. �:שספק נ�"פ�S � ��קש� �~�~ש�"�:� �Sספק ��א, �:�a ש�ס�"�:נ�"ם �~�~ש�"�:�"ם �Sע��"� �ם �:ש�~�"��S ��"נ�~�" נ��~ר.',
    ),
    h('div', { class: 'form-grid', style: { marginTop: '12px' } },
      field('ספק', providerSel),
      field('×ž×•×“×œ', h('div', {}, modelIn, datalist)),
      field('�~פת� API', keyIn),
      field('Account ID', accountIn),
      h('div', { class: 'full' }, field('�:ת�"�ת API (א�"פצ�"�"נ�S�")', baseIn)),
      h('div', { class: 'full' }, field('Cloudflare � �:�~� �ש��"נ�"ת ��ת א�ת (ACCOUNT_ID,TOKEN ��:�S ש�"ר�)', cfBulk)),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } },
      h('button', { class: 'btn btn-sm', onclick: addBulk }, '+ ��"סף �ש��"נ�"ת Cloudflare'),
      h('span', { class: 'tiny muted', text: '�S�:�S �ש��"�x �~�:ס� �"�"�~�"ת נפר�ת ש�S 10,000 Neurons � ��ר�"�:� תס�"�� ��"נ�"�ם.' }),
    ),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', onclick: add }, '+ ��"סף �S�ר�"�:�'),
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const all = poolEntries(store.state);
          if (!all.length) { toast('��ר�"�:� ר�"ק�', 'bad'); return; }
          let ok = 0;
          for (const entry of all) {
            const res = await testPoolEntry(entry.id);
            if (res.ok) ok++;
          }
          toast(`${ok}/${all.length} �~פת��"ת ענ�"`, ok ? 'ok' : 'bad');
          ui.rerender();
        },
      }, '���"ק את �:�"�Sם'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { resetCooldowns(store.state); store.save(true); store.emit(); ui.rerender(); } }, 'אפס ק�"ר�"ר�"ם'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'https://github.com/open-free-llm-api/awesome-freellm-apis', target: '_blank', rel: 'noopener', text: 'רש�"�~ת �ספק�"ם ���"נ�~�"�"ם � ' }),
    ),
    helpBlock(providerSel),
    rows.length ? h('div', { style: { marginTop: '8px' } }, rows) : h('div', { class: 'small muted', style: { marginTop: '10px' }, text: '��ר�"�:� ר�"ק�. ��"סף �~פת� א�� �"�~ע�S� � Groq �"-Gemini �ם ��ת��S� ��~�"�~�Sצת.' }),
    notice('��פ�פ�x ��~פת��"ת נש�~ר�"ם �~ק�"�~�"ת ��S��. �:��" ש�ס�"�:נ�"ם �ענ�x �"שת�~ש�" ��ם, ��"סף א�"תם �:ס�"��"ת �ר�"פ�": ' +
      Object.values(ENV_HINT).filter((v) => v !== 'â€”').slice(0, 8).join(' Â· ') + ' � ��ר�"�:� נ�נ�"ת �~�ם א�"���"�~���"ת.', 'blue'),
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
  const envName = h('code', { text: ENV_HINT[providerSel.value] || 'â€”' });
  providerSel.addEventListener('change', () => {
    const p = providerSel.value;
    const def = PROVIDERS[p] || {};
    keyLink.href = def.keyUrl || '#';
    keyLink.textContent = keyLabel(p);
    note.textContent = def.note || '';
    envName.textContent = ENV_HINT[p] || 'â€”';
  });

  const step = (title, body) => h('li', { style: { marginBottom: '10px' } },
    h('b', { style: { fontSize: '13px' }, text: title }),
    body,
  );

  return h('details', { style: { marginTop: '12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 12px' } },
    h('summary', { style: { cursor: 'pointer', fontSize: '13px' }, text: 'א�"�a �~��ר�"ם �~�"��S � ��"רא�"ת צע� א�ר צע�' }),
    h('ol', { class: 'list-clean', style: { marginTop: '10px' } },
      step('1. �נפק �~פת� אצ�S �ספק', h('div', {},
        h('div', { class: 'small muted', text: '��ר ספק �S�~ע�S� �"�S�ץ ע�S �ק�"ש�"ר. ��רש�~� ��"נ�~�"ת �"�Sא ��"רשת �:ר���"ס אשרא�" אצ�S Groq, Gemini, Z.ai, OpenRouter �"-Cloudflare.' }),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px' } }, keyLink),
        note,
      )),
      step('2. ��"סף א�"ת�" �S�ר�"�:�', h('div', { class: 'small muted' },
        '���ק את ��~פת� �ש�� "�~פת� API", ��ר �~�"��S (אפשר �S�ק�S�"� �"�נ�"ת), �"�S�ץ "+ ��"סף �S�ר�"�:�". �S�ץ "���"ק" �:��" �S�"�"�א ש��~פת� ע�"נ�, �"אם �Sא � �ש��"א� ת�"פ�"ע �S�"� �ש�"ר�. �~פת� א�� �~ספ�"ק �:��" �S�ת��"�S; �:�S �~פת� נ�"סף �~���"�S את �תקר� ��"�"�~�"ת.',
      )),
      step('3. א�"ת�" �~פת� �Sענ�x (24/7)', h('div', {},
        h('div', { class: 'small muted', text: '���"�� שרץ �-GitHub Actions �Sא ר�"א� את ��פ�פ�x. ��"סף את ��~פת� �:ס�"� �ר�"פ�" �שם ��~��"�"ק:' }),
        h('div', { class: 'row wrap', style: { gap: '6px', margin: '6px 0' } }, h('span', { class: 'small', text: 'שם �ס�"�:' }), envName),
        h('pre', { class: 'code', text: 'gh secret set GROQ_API_KEY' }),
        h('div', { class: 'small muted', text: 'א�" ��פ�פ�x: Settings �  Secrets and variables �  Actions �  New repository secret. שם �ס�"� ��"�"� �S��"�"ת ���"�"ק �:�~�" �����S�, א�רת ��ר�"�:� �Sא ת��� א�"ת�".' }),
      )),
      step('4. ���"ק ש�� ע��', h('div', { class: 'small muted' },
        '�רץ את Firm loop �"�נ�"ת �"�פש ��S�"� את �ש�"ר� model pool: ⬦ �"את answered by ⬦ �-data/last-run.json. אם ספק נ�:ש�S ת�~�"� ת�"פ�"ע ש�"רת fallback from ⬦ עם �ס�"��.',
      )),
    ),
    h('div', { style: { marginTop: '6px' } },
      h('div', { class: 'small', style: { marginBottom: '4px' }, text: 'ר�"צ� רש�"�~� �~פ�"רשת עם �~�"��S�"ם ש�"נ�"ם �Sא�"ת�" ספק? �שת�~ש �ס�"� א��:' }),
      h('pre', { class: 'code', text: 'LLM_KEYS=[{"provider":"groq","key":"gsk_...","model":"llama-3.3-70b-versatile"},\n          {"provider":"cloudflare","key":"cf_...","accountId":"...","model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast"}]' }),
    ),
    h('ul', { class: 'list-clean', style: { marginTop: '8px' } },
      h('li', { class: 'small muted', text: '��ר�"�:� ��"�רת את ��~פת� ש��:�" �~��~�x �Sא נ�"צ�S, �~�:��ת RPM/RPD, �"�~��S�ת א�"���"�~���"ת ע�S �~פת� �ק�"ר�"ר א�" �:�� שנ��~ר� �S�" ��~�:ס� ��"�"�~�"ת.' }),
      h('li', { class: 'small muted', text: 'ספק�"ם �:�~�" Groq �"-NVIDIA ��"ס�~�"ם קר�"א� �"ש�"ר� �~��פ�פ�x (CORS) � ����"ק� �:א�x ת���"ר ש��"את רשת, א��S �ר�"צ� �ענ�x תק�"נ�. Gemini �"-OpenRouter ע�"���"ם �ם �:א�x.' }),
      h('li', { class: 'small muted', text: '�:�S ��~פת��"ת נש�~ר�"ם �~ק�"�~�"ת ��פ�פ�x ���, �"�-runner �~נק� א�"תם �~-data/state.json �Sפנ�" �:�S commit.' }),
    ),
  );
}

function keyLabel(providerId) {
  const def = PROVIDERS[providerId];
  if (!def?.keyUrl) return 'א�"�x �ף �~פת��"ת �Sספק ���';
  return `�נפק �~פת� ${def.label} � `;
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
  const agents = ["א�"ר�"� · CIO", "נ�"ע� · א�"פ���"�~�"�צ�"�", "�נ�"א�S · ס�"�:�"נ�"ם", "ת�~ר · ��"צ�"ע", "�S�"� · נ�"ת�"�"];
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
    let summary = "�~��:� �Sפע�"�S�"ת";
    let detail = "";
    let priority = "low";
    if (lastEvent) {
      summary = lastEvent.text.slice(0, 40) + (lastEvent.text.length > 40 ? "â€¦" : "");
      detail = `�~את ${lastEvent.at ? new Date(lastEvent.at).toLocaleTimeString("he-IL") : "�Sא �"��"ע"}`;
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
      agent: "�~ער�:ת",
      summary: activeDesk ? `�רסת ${activeDesk.label}` : "א�"�x �רס� פע�"�S�",
      detail: activeDesk ? `ס�"�~�"�x: ${activeDesk.symbol} · ${activeDesk.tf}` : "א�"�x ���ר�"ת",
      priority: "medium"
    });
  }
  return activities;
}

