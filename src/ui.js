// Tiny DOM + chart + formatting helpers. No framework, no dependencies.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Like el.append(), but drops null/false instead of stringifying them.
export function mount(root, ...children) {
  for (const child of children.flat(6)) {
    if (child == null || child === false) continue;
    root.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return root;
}

const nf = new Intl.NumberFormat('en-US');

export function num(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return nf.format(Number(Number(v).toFixed(digits)));
}

export function pct(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function money(v, currency = '$') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return currency + nf.format(Math.round(Number(v)));
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'עכשיו';
  if (sec < 60) return `לפני ${sec}ש׳`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `לפני ${min}ד׳`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr}ש׳`;
  const day = Math.floor(hr / 24);
  return `לפני ${day} ימים`;
}

export function clock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function shortDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function signClass(v) {
  return Number(v) > 0 ? 'green' : Number(v) < 0 ? 'red' : 'muted';
}

const COLORS = { green: '#2ecc71', red: '#f05b5b', gold: '#e0b64a', blue: '#58a6ff', muted: '#8695a8' };

export function chart(values, { height = 60, color = 'green', fill = true, showZero = false } = {}) {
  const series = (values || []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (series.length < 2) {
    return h('div', { class: 'empty', style: { padding: '10px', fontSize: '11px', height: height + 'px', display: 'grid', placeItems: 'center' } },
      'ממתין לנתוני בקטסט');
  }
  const W = 300;
  const H = 100;
  let min = Math.min(...series);
  let max = Math.max(...series);
  if (showZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const pts = series.map((v, i) => [ (i / (series.length - 1)) * W, H - ((v - lo) / (hi - lo)) * H ]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${W},${H} L0,${H} Z`;
  const up = series[series.length - 1] >= series[0];
  const stroke = COLORS[color] || (up ? COLORS.green : COLORS.red);
  const id = 'grad' + Math.random().toString(36).slice(2, 8);
  const wrap = h('div', { style: { height: height + 'px', width: '100%' } });
  wrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="100%" style="display:block;overflow:visible">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${fill ? `<path d="${area}" fill="url(#${id})" stroke="none"/>` : ''}
      <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>`;
  return wrap;
}

export function statusTag(status) {
  const map = {
    live: ['live', 'חי על נייר'],
    'dry-run': ['dry', 'הרצה על יבש'],
    optimizing: ['opt', 'בכיול'],
    research: ['', 'במחקר'],
    paused: ['paused', 'מושהה'],
  };
  const [cls, label] = map[status] || ['', status || '—'];
  return h('span', { class: 'tag ' + cls }, label);
}

export function tag(text, cls = '') {
  return h('span', { class: 'tag ' + cls }, text);
}

export function toast(message, kind = '') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h('div', { class: 'toast ' + kind, text: message });
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('הועתק ללוח', 'ok')).catch(() => toast('העתקה נכשלה', 'bad'));
  } else {
    toast('הדפדפן חסם העתקה — סמן והעתק ידנית', 'bad');
  }
}

export function downloadFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function openModal(title, body, { wide = false } = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  const modal = h('div', { class: 'modal', style: wide ? { width: 'min(1040px, 100%)' } : {} },
    h('div', { class: 'modal-head' },
      h('h2', { text: title }),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: closeModal }, 'סגור'),
    ),
    body,
  );
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); } }, modal);
  root.appendChild(backdrop);
  return { close: closeModal };
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) clear(root);
}

export function copyButton(text) {
  return h('button', { class: 'copy-btn', onclick: () => copyText(text), title: 'העתק' }, 'העתק');
}

export function commandBlock(cmd) {
  return h('div', { class: 'cmd' }, cmd, copyButton(cmd));
}

export function kpi(label, value, delta, chartValues, color = 'green') {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'label', text: label }),
    h('div', { class: 'value' }, value),
    delta != null ? h('div', { class: 'delta ' + signClass(delta) }, pct(delta)) : null,
    chartValues ? chart(chartValues, { height: 34, color, fill: true }) : null,
  );
}

export function notice(text, kind = '') {
  return h('div', { class: 'notice ' + kind }, h('span', { class: 'ic' }, kind === 'bad' ? '⚠' : 'ⓘ'), h('span', { text }));
}

export function empty(text) {
  return h('div', { class: 'empty', text });
}

export function section(title, subtitle, ...children) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: title }), subtitle ? h('div', { class: 'card-sub', text: subtitle }) : null),
    ),
    ...children,
  );
}

export function progressBar(value, warn = false) {
  return h('div', { class: 'bar' + (warn ? ' warn' : '') }, h('i', { style: { width: Math.max(0, Math.min(100, value || 0)) + '%' } }));
}

/* ---- Agent speech / thinking bubbles ---- */

export function speechBubble(text, type = 'speak') {
  const cls = 'bubble ' + (type === 'think' ? 'think' : type === 'status' ? 'status' : 'speak');
  const dots = type === 'think'
    ? h('div', { class: 'typing-dots' }, h('span'), h('span'), h('span'))
    : null;
  return h('div', { class: 'agent-bubble-wrap' },
    h('div', { class: cls, text }, dots)
  );
}

export function agentBubble(agent) {
  if (agent.speech) {
    return speechBubble(agent.speech, agent.speechType || 'speak');
  }
  if (agent.thinking) {
    return speechBubble(agent.thinking, 'think');
  }
  if (agent.status === 'busy') {
    return speechBubble('עובד על משימה…', 'status');
  }
  return null;
}

/* ---- Live price indicator ---- */

export function livePrice(symbol, price, changePct, connected = true) {
  const dir = changePct == null ? '' : (changePct >= 0 ? 'up' : 'down');
  const dotCls = 'dot' + (connected ? '' : ' off');
  const chg = changePct == null ? '—' : (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  return h('div', { class: 'live-price' },
    h('div', { class: dotCls }),
    h('span', { class: 'sym', text: symbol }),
    h('span', { class: dir, text: num(price, 2) }),
    h('span', { class: dir + ' ' + signClass(changePct), text: chg }),
  );
}

/* ---- Portfolio table row helpers ---- */

export function positionRow(pos, currentPrice) {
  const qty = num(pos.quantity, 6);
  const entry = num(pos.averageEntryPrice, 2);
  const mark = num(currentPrice, 2);
  const pnl = currentPrice ? ((currentPrice - pos.averageEntryPrice) * pos.quantity) : 0;
  const pnlPct = currentPrice ? ((currentPrice / pos.averageEntryPrice) - 1) * 100 : 0;
  const cls = pnl >= 0 ? 'up' : 'down';
  return h('div', { class: 'position-row' },
    h('div', { class: 'sym', text: pos.symbol }),
    h('div', { class: 'qty', text: qty }),
    h('div', { class: 'entry', text: 'כניסה: ' + entry }),
    h('div', { class: 'mark', text: 'מחיר: ' + mark }),
    h('div', { class: 'pnl ' + cls, text: pct(pnlPct) + ' · ' + money(pnl) }),
    h('div', { class: 'small muted', text: 'פוזיציה פתוחה' }),
  );
}

export function tradeRow(trade) {
  const sideCls = trade.side === 'BUY' ? 'buy' : 'sell';
  const time = trade.timestamp ? new Date(trade.timestamp).toLocaleTimeString('he-IL') : '—';
  return h('div', { class: 'trade-row' },
    h('div', { class: 'side ' + sideCls, text: trade.side }),
    h('div', { class: 'sym', text: trade.symbol }),
    h('div', { class: 'entry', text: num(trade.price, 2) }),
    h('div', { class: 'qty', text: num(trade.quantity, 6) }),
    h('div', { class: 'fee', text: 'עמלה ' + money(trade.fee) }),
    h('div', { class: 'tiny muted', text: time }),
  );
}
