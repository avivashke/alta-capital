// Dedicated UI Card for WhatsApp Web Group Integration inside #/gann.
// Displays live WhatsApp Web connection/QR controls (on PC Base Server), single-group whitelist selector,
// active-asset Gann overlay (extracted price levels, Sq9 degrees, dates, 1-click anchor apply),
// and a cross-device synced feed of summarized insights with author name + "Source & Context" modal button.

import { store } from './store.js';
import { h, tag, toast, timeAgo } from './ui.js';
import { gannExplainButton } from './gann_guide.js';
import {
  fetchWhatsAppStatus,
  launchWhatsAppLogin,
  saveWhatsAppConfig,
  runWhatsAppScan,
  openWhatsAppSourceModal,
  openWhatsAppImportModal,
  getSeedWhatsAppReport,
} from './whatsapp_agent.js';

const waUiState = {
  loaded: false,
  loadingStatus: false,
  scanning: false,
  loggingIn: false,
  status: null,
  groupInput: '',
  autoScanMinutes: 0,
  filter: 'all', // 'all' | 'asset' | 'gann' | 'signal' | 'macro_news'
  pollTimer: null,
};

const ROLE_HE = {
  target: 'יעד',
  support: 'תמיכה',
  resistance: 'התנגדות',
  stop: 'סטופ',
  entry: 'כניסה',
  anchor: 'עוגן',
};

const CAT_HE = {
  gann: '📐 גאן',
  signal: '🎯 איתות/רמות',
  macro_news: '📰 מאקרו/חדשות',
};

function ensureStatusLoaded(ui) {
  if (waUiState.loaded || waUiState.loadingStatus) return;
  waUiState.loadingStatus = true;
  fetchWhatsAppStatus()
    .then((st) => {
      waUiState.status = st;
      waUiState.loaded = true;
      if (st.groupName && !waUiState.groupInput) waUiState.groupInput = st.groupName;
      if (st.config?.autoScanMinutes != null) waUiState.autoScanMinutes = Number(st.config.autoScanMinutes) || 0;
      if (st.job?.busy && st.job?.mode === 'login') {
        waUiState.loggingIn = true;
        startLoginPoll(ui);
      }
    })
    .finally(() => {
      waUiState.loadingStatus = false;
      ui?.rerender?.();
    });
}

function startLoginPoll(ui) {
  if (waUiState.pollTimer) clearInterval(waUiState.pollTimer);
  let ticks = 0;
  waUiState.pollTimer = setInterval(async () => {
    ticks += 1;
    const st = await fetchWhatsAppStatus();
    waUiState.status = st;
    if (st.groupName && !waUiState.groupInput) waUiState.groupInput = st.groupName;
    if (!st.job?.busy || ticks > 100) {
      clearInterval(waUiState.pollTimer);
      waUiState.pollTimer = null;
      waUiState.loggingIn = false;
      if (st.loggedIn) {
        toast(`✓ WhatsApp Web חובר! זוהו ${st.discoveredGroups?.length || 0} צ׳אטים — בחר את הקבוצה שלך.`, 'ok');
      } else if (st.job?.lastError) {
        toast(st.job.lastError, 'bad');
      }
      ui?.rerender?.();
    } else {
      ui?.rerender?.();
    }
  }, 2500);
}

export function renderWhatsAppGannCard(a, cfg, symbol, ui, { onApplyAnchor, onSelectAsset } = {}) {
  ensureStatusLoaded(ui);

  const st = waUiState.status;
  if (!store.state.whatsappGann || !store.state.whatsappGann.insights?.length) {
    store.state.whatsappGann = getSeedWhatsAppReport();
  }
  const report = store.state.whatsappGann || st?.latestReport || getSeedWhatsAppReport();
  const connected = !!st?.connected;
  const loggedIn = !!st?.loggedIn;
  const discoveredGroups = Array.isArray(st?.discoveredGroups) ? st.discoveredGroups : [];
  const activeGroupName = waUiState.groupInput || st?.groupName || report?.groupName || '';

  const assetSig = report?.assetSignals?.[symbol] || null;
  const allInsights = Array.isArray(report?.insights) ? report.insights : [];

  const filteredInsights = allInsights.filter((ins) => {
    if (waUiState.filter === 'asset') return (ins.symbols || []).includes(symbol);
    if (waUiState.filter === 'gann') return (ins.categories || []).includes('gann');
    if (waUiState.filter === 'signal') return (ins.categories || []).includes('signal');
    if (waUiState.filter === 'macro_news') return (ins.categories || []).includes('macro_news');
    return true;
  });

  // Check if the group mentioned an anchor/key price or date for the active symbol
  const suggestedPriceObj = assetSig?.levels?.find((l) => l.role === 'anchor')
    || assetSig?.levels?.find((l) => ['support', 'entry', 'resistance', 'target'].includes(l.role))
    || null;
  const suggestedDateObj = assetSig?.dates?.[0] || null;

  const groupInputEl = h('input', {
    type: 'text',
    value: activeGroupName,
    placeholder: 'הקלד שם מדויק של קבוצת הוואטסאפ (או בחר מהרשימה)',
    style: { minWidth: '230px', flex: '1' },
    oninput: (e) => { waUiState.groupInput = e.target.value; },
  });

  const groupSelectEl = discoveredGroups.length
    ? h('select', {
        value: discoveredGroups.includes(activeGroupName) ? activeGroupName : '',
        style: { maxWidth: '250px' },
        onchange: (e) => {
          if (e.target.value) {
            waUiState.groupInput = e.target.value;
            groupInputEl.value = e.target.value;
          }
        },
      },
      h('option', { value: '', text: `— בחר מתוך ${discoveredGroups.length} צ׳אטים שזוהו —` }),
      discoveredGroups.map((g) => h('option', { value: g, text: g })),
    )
    : null;

  const autoScanSelect = h('select', {
    value: String(waUiState.autoScanMinutes || 0),
    style: { maxWidth: '150px' },
    onchange: (e) => { waUiState.autoScanMinutes = Number(e.target.value) || 0; },
  },
    h('option', { value: '0', text: 'סריקה ידנית בלבד' }),
    h('option', { value: '15', text: 'אוטומטי: כל 15 דק׳' }),
    h('option', { value: '30', text: 'אוטומטי: כל 30 דק׳' }),
    h('option', { value: '60', text: 'אוטומטי: כל שעה' }),
    h('option', { value: '180', text: 'אוטומטי: כל 3 שעות' }),
  );

  const statusTag = connected
    ? (loggedIn ? tag('🟢 WhatsApp Web מחובר (קריאה בלבד)', 'live') : tag('🟡 נדרשת סריקת QR חד-פעמית', 'opt'))
    : (report ? tag('☁️ מסונכרן מהענן (צפייה מכל מכשיר)', 'live') : tag('💻 התחבר מהמחשב לחיבור WhatsApp Web', 'dry'));

  return h('div', {
    class: 'card',
    style: {
      marginTop: '14px',
      borderColor: 'rgba(37, 211, 102, 0.42)',
      background: 'linear-gradient(180deg, rgba(10, 26, 28, 0.94), rgba(9, 14, 24, 0.96))',
    },
  },
    // Header
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: `💬 מודיעין קבוצת וואטסאפ משולב בגאן${report?.groupName ? ` · "${report.groupName}"` : ''}` }),
        h('div', {
          class: 'card-sub',
          text: 'קריאה בלבד מקבוצה אחת שבחרת (Chrome המקומי) · מחלץ ניתוחי גאן, איתותי מסחר וחדשות מאקרו, משקלל בתחזית ומסנכרן תובנות + הודעת מקור וקונטקסט לכל המכשירים',
        }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
        gannExplainButton('whatsapp_gann', a, cfg, symbol),
        statusTag,
        report?.scannedAt ? tag(`נסרק ${timeAgo(report.scannedAt)}`, 'dry') : null,
      ),
    ),

    // Local PC Controls (QR Login + Whitelisted Group Selector + Scan)
    connected
      ? h('div', {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(15, 23, 42, 0.72)',
            border: '1px solid rgba(37, 211, 102, 0.25)',
            marginBottom: '12px',
          },
        },
          h('button', {
            class: 'btn btn-sm',
            disabled: waUiState.loggingIn || waUiState.scanning || st?.job?.busy,
            onclick: async () => {
              waUiState.loggingIn = true;
              ui?.rerender?.();
              const res = await launchWhatsAppLogin();
              if (res.ok) {
                toast(res.message || 'חלון WhatsApp Web נפתח — סרוק QR מהטלפון', 'ok');
                startLoginPoll(ui);
              } else {
                waUiState.loggingIn = false;
                toast(res.error || 'שגיאה בפתיחת WhatsApp Web', 'bad');
                ui?.rerender?.();
              }
            },
          }, waUiState.loggingIn ? '⏳ ממתין לסריקת QR…' : (loggedIn ? '🔄 חבר מחדש QR / רענן רשימת קבוצות' : '📱 חבר WhatsApp Web (QR)')),

          groupSelectEl,
          groupInputEl,
          autoScanSelect,

          h('button', {
            class: 'btn btn-sm btn-ghost',
            disabled: waUiState.scanning,
            onclick: async () => {
              const name = (groupInputEl.value || '').trim();
              if (!name) {
                toast('הזן או בחר שם קבוצת וואטסאפ לפני השמירה', 'bad');
                return;
              }
              waUiState.groupInput = name;
              const res = await saveWhatsAppConfig({
                groupName: name,
                autoScanMinutes: waUiState.autoScanMinutes,
              });
              if (res.ok) {
                toast(`✓ נשמרה קבוצת היעד "${name}" (קריאה בלבד)`, 'ok');
                waUiState.status = await fetchWhatsAppStatus();
                ui?.rerender?.();
              } else {
                toast(res.error || 'שגיאה בשמירת הגדרות וואטסאפ', 'bad');
              }
            },
          }, '💾 שמור קבוצה'),

          h('button', {
            class: 'btn btn-sm btn-primary',
            style: { background: '#16a34a', borderColor: '#22c55e' },
            disabled: waUiState.scanning || waUiState.loggingIn || st?.job?.busy,
            onclick: async () => {
              const name = (groupInputEl.value || activeGroupName || '').trim();
              if (!name) {
                toast('בחר או הקלד קודם את שם קבוצת הוואטסאפ', 'bad');
                return;
              }
              waUiState.scanning = true;
              waUiState.groupInput = name;
              ui?.rerender?.();
              await saveWhatsAppConfig({ groupName: name, autoScanMinutes: waUiState.autoScanMinutes });
              const res = await runWhatsAppScan({ groupName: name });
              waUiState.scanning = false;
              waUiState.status = await fetchWhatsAppStatus();
              if (res.ok) {
                toast(`✓ נסרקה קבוצת "${res.report.groupName}": ${res.report.relevantInsightsCount} תובנות שולבו בגאן וסונכרנו!`, 'ok');
              } else {
                toast(res.error || 'שגיאה בסריקת הקבוצה', 'bad');
              }
              ui?.rerender?.();
            },
          }, waUiState.scanning ? '⏳ סורק קבוצת וואטסאפ…' : '🔍 סרוק קבוצה ושלב בגאן'),
          h('button', {
            class: 'btn btn-sm btn-ghost',
            onclick: () => openWhatsAppImportModal(ui),
          }, '📝 עדכן / הוסף הודעות'),
        )
      : h('div', {
          class: 'notice',
          style: { marginBottom: '12px', fontSize: '12.5px' },
        },
          h('div', { class: 'row between wrap', style: { gap: '8px', alignItems: 'center' } },
            h('span', {
              style: { flex: '1', minWidth: '220px' },
              text: report
                ? `☁️ צופה בנתונים מסונכרנים מקבוצת "${report.groupName}" (${report.relevantInsightsCount} תובנות פעילות · ${report.totalMessagesRead || 0} הודעות נקראו ועובדו, כולל סמכויות יגאל ושמחה).`
                : 'מודיעין קבוצת הוואטסאפ פעיל ומסנכרן תובנות.',
            }),
            h('button', {
              class: 'btn btn-sm btn-primary',
              style: { background: '#16a34a', borderColor: '#22c55e' },
              onclick: () => openWhatsAppImportModal(ui),
            }, '📝 עדכן / הוסף הודעות מהקבוצה (יגאל & שמחה)'),
          ),
        ),

    // Live inline QR Code box while waiting for phone scan (works even if Chrome popup is behind/hidden)
    (waUiState.loggingIn || (st?.job?.busy && st?.job?.mode === 'login'))
      ? h('div', {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
            padding: '14px 16px',
            marginBottom: '12px',
            borderRadius: '12px',
            background: 'rgba(6, 78, 59, 0.25)',
            border: '1px solid rgba(37, 211, 102, 0.55)',
          },
        },
          st?.qrAvailable && st?.origin
            ? h('img', {
                src: `${st.origin}/api/whatsapp-agent/qr?t=${Date.now()}`,
                alt: 'WhatsApp Web QR Code',
                style: {
                  width: '230px',
                  height: '230px',
                  objectFit: 'contain',
                  background: '#ffffff',
                  padding: '10px',
                  borderRadius: '12px',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                },
              })
            : h('div', {
                style: {
                  width: '230px',
                  height: '230px',
                  display: 'grid',
                  placeItems: 'center',
                  textAlign: 'center',
                  background: 'rgba(15, 23, 42, 0.85)',
                  borderRadius: '12px',
                  border: '1px dashed rgba(37, 211, 102, 0.45)',
                  padding: '14px',
                  color: '#86efac',
                  fontSize: '13px',
                },
                text: '⏳ טוען את קוד ה-QR מ-WhatsApp Web… (כמה שניות)',
              }),
          h('div', { style: { flex: '1', minWidth: '220px', lineHeight: '1.65' } },
            h('div', { style: { fontWeight: 700, fontSize: '15px', color: '#86efac', marginBottom: '6px' }, text: '📱 סרוק את קוד ה-QR מהטלפון שלך' }),
            h('div', { class: 'small', text: '1. פתח WhatsApp בטלפון → תפריט (⋮ / הגדרות) → מכשירים מקושרים (Linked Devices).' }),
            h('div', { class: 'small', text: '2. לחץ "קישור מכשיר" (Link a Device) וכוון את המצלמה לקוד ה-QR שכאן משמאל.' }),
            h('div', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'הקוד מתעדכן כאן אוטומטית כל 2.5 שניות. מיד אחרי הסריקה החיבור יישמר והקבוצות ייטענו אוטומטית.' }),
          ),
        )
      : null,

    // VIP Authorities Banner — Yigal & Simcha (הסמכויות האמינות ביותר בקבוצה)
    (() => {
      const vipInsights = allInsights.filter((ins) => ins.authorIsVip || /יגאל|שמחה/i.test(ins.author || ''));
      if (!vipInsights.length) return null;
      return h('div', {
        class: 'card',
        style: {
          marginBottom: '12px',
          background: 'linear-gradient(135deg, rgba(45, 27, 3, 0.95), rgba(18, 14, 28, 0.96))',
          borderColor: 'rgba(245, 158, 11, 0.65)',
          boxShadow: '0 0 16px rgba(245, 158, 11, 0.18)',
          padding: '12px 14px',
        },
      },
        h('div', { class: 'row between wrap', style: { gap: '8px', marginBottom: '8px', alignItems: 'center' } },
          h('div', {},
            h('div', { style: { fontWeight: '800', fontSize: '14.5px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' } },
              '👑 תובנות ורמות מפתח מפי יגאל ושמחה (הסמכויות האמינות ביותר בקבוצה)'
            ),
            h('div', { class: 'tiny muted', text: 'הודעות, זוויות גאן ורמות מחיר מפי יגאל ושמחה מקבלות עדיפות עליונה (משקל פי 4.5) בשקלול התחזית והעוגנים.' }),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            tag(`⭐ ${vipInsights.length} תובנות VIP מאומתות`, 'live'),
            h('button', {
              class: 'btn btn-sm',
              style: { borderColor: '#f59e0b', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)' },
              onclick: () => openWhatsAppImportModal(ui),
            }, '📝 עדכן הודעות מהקבוצה'),
          ),
        ),
        h('div', { class: 'grid cols-2', style: { gap: '8px' } },
          ...vipInsights.slice(0, 4).map((ins) => {
            const isYigal = /יגאל/i.test(ins.author);
            const authorLabel = isYigal ? '👑 יגאל (סמכות עליונה)' : '👑 שמחה (סמכות עליונה)';
            const primarySym = (ins.symbols || []).find((s) => s !== 'MACRO') || null;
            return h('div', {
              class: 'card',
              style: {
                background: 'rgba(10, 15, 26, 0.92)',
                borderColor: 'rgba(245, 158, 11, 0.45)',
                padding: '8px 10px',
              },
            },
              h('div', { class: 'row between wrap', style: { gap: '4px', marginBottom: '4px', alignItems: 'center' } },
                h('strong', { style: { color: '#fbbf24', fontSize: '12px' }, text: authorLabel }),
                h('div', { class: 'row wrap', style: { gap: '4px' } },
                  ...(ins.symbols || []).map((s) => tag(s, s === symbol ? 'live' : 'dry')),
                  ins.bias === 'bullish' ? tag('🟢 שורי', 'live') : ins.bias === 'bearish' ? tag('🔴 דובי', 'red') : null,
                ),
              ),
              h('div', { class: 'small', style: { fontSize: '12px', lineHeight: '1.45', color: '#f1f5f9' }, text: ins.summary }),
              h('div', { class: 'row between wrap', style: { gap: '4px', marginTop: '6px', alignItems: 'center' } },
                h('span', { class: 'tiny muted mono', text: ins.timestampRaw || '' }),
                h('div', { class: 'row wrap', style: { gap: '4px' } },
                  primarySym && primarySym !== symbol && typeof onSelectAsset === 'function'
                    ? h('button', {
                        class: 'btn btn-sm btn-ghost',
                        style: { fontSize: '11px', padding: '2px 6px' },
                        onclick: () => onSelectAsset(primarySym),
                      }, `נתח ${primarySym}`)
                    : null,
                  h('button', {
                    class: 'btn btn-sm btn-ghost',
                    style: { fontSize: '11px', padding: '2px 6px', color: '#fbbf24' },
                    onclick: () => openWhatsAppSourceModal(ins, report?.groupName || 'קבוצת וואטסאפ'),
                  }, '💬 הודעת מקור'),
                ),
              ),
            );
          }),
        ),
      );
    })(),

    // Active Asset Matched Gann Overlay (if current symbol appears in group)
    assetSig
      ? h('div', {
          class: 'card',
          style: {
            marginBottom: '12px',
            background: 'rgba(13, 33, 38, 0.85)',
            borderColor: 'rgba(46, 204, 113, 0.45)',
            padding: '10px 12px',
          },
        },
          h('div', { class: 'row between wrap', style: { gap: '8px', marginBottom: '8px' } },
            h('div', {},
              h('strong', { style: { fontSize: '13.5px', color: '#86efac' }, text: `📌 ממצאי קבוצת הוואטסאפ עבור ${symbol}` }),
              h('div', {
                class: 'tiny muted',
                text: `${assetSig.mentions} אזכורים · כותבים: ${(assetSig.authors || []).join(', ') || '—'} · שוקלל אוטומטית בתחזית העליונה`,
              }),
            ),
            h('div', { class: 'row wrap', style: { gap: '6px' } },
              tag(`ציון קבוצה: ${assetSig.score}/100 (${assetSig.bias})`, assetSig.biasKey === 'bullish' ? 'live' : assetSig.biasKey === 'bearish' ? 'red' : 'opt'),
              (suggestedPriceObj || suggestedDateObj) && typeof onApplyAnchor === 'function'
                ? h('button', {
                    class: 'btn btn-sm btn-primary',
                    onclick: () => {
                      onApplyAnchor({
                        price: suggestedPriceObj?.price || null,
                        date: suggestedDateObj?.dateIso || null,
                        sourceLabel: suggestedPriceObj?.author || suggestedDateObj?.author || report?.groupName,
                      });
                    },
                  }, `📐 החל עוגן מהוואטסאפ (${suggestedPriceObj ? suggestedPriceObj.price : ''}${suggestedDateObj ? ` · ${suggestedDateObj.dateIso}` : ''})`)
                : null,
            ),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            ...(assetSig.levels || []).slice(0, 8).map((lv) => {
              const diffPct = a?.currentPrice ? (((lv.price - a.currentPrice) / a.currentPrice) * 100).toFixed(1) : null;
              return tag(
                `${ROLE_HE[lv.role] || lv.role}: ${lv.price}${diffPct != null ? ` (${Number(diffPct) > 0 ? '+' : ''}${diffPct}%)` : ''} · ${lv.author}`,
                lv.role === 'target' ? 'live' : lv.role === 'stop' ? 'red' : 'opt',
              );
            }),
            ...(assetSig.degrees || []).map((deg) => tag(`Sq9 ${deg}°`, 'opt')),
            ...(assetSig.dates || []).slice(0, 5).map((dt) => tag(`📅 ${dt.dateIso} (${dt.author})`, 'opt')),
          ),
        )
      : null,

    // AI Summary from local Ollama (if generated)
    report?.aiSummary?.text
      ? h('div', {
          class: 'notice ok',
          style: { marginBottom: '12px', whiteSpace: 'pre-wrap', lineHeight: '1.58', fontSize: '12.5px' },
          text: `🤖 תקציר AI מקבוצת "${report.groupName}" (${report.aiSummary.model || 'Local AI'}):\n${report.aiSummary.text}`,
        })
      : null,

    // Filter Bar & Summarized Insights Feed (with Author + "Open Source & Context" button)
    report
      ? h('div', {},
          h('div', { class: 'row between wrap', style: { gap: '8px', marginBottom: '10px', alignItems: 'center' } },
            h('div', { class: 'row wrap', style: { gap: '6px' } },
              ...[
                { id: 'all', label: `הכל (${allInsights.length})` },
                { id: 'asset', label: `נכס נוכחי: ${symbol} (${allInsights.filter((x) => (x.symbols || []).includes(symbol)).length})` },
                { id: 'gann', label: `📐 גאן (${allInsights.filter((x) => (x.categories || []).includes('gann')).length})` },
                { id: 'signal', label: `🎯 איתותים ורמות (${allInsights.filter((x) => (x.categories || []).includes('signal')).length})` },
                { id: 'macro_news', label: `📰 מאקרו וחדשות (${allInsights.filter((x) => (x.categories || []).includes('macro_news')).length})` },
              ].map((f) => h('button', {
                class: `btn btn-sm ${waUiState.filter === f.id ? 'btn-primary' : 'btn-ghost'}`,
                onclick: () => {
                  waUiState.filter = f.id;
                  ui?.rerender?.();
                },
              }, f.label)),
            ),
            h('div', {
              class: 'tiny muted',
              text: `נקראו ${report.totalMessagesRead || 0} הודעות · הטיה כללית: ${report.overallBias || 'מאוזן'} (${report.overallScore || 50}/100)`,
            }),
          ),

          filteredInsights.length
            ? h('div', { style: { display: 'grid', gap: '8px', maxHeight: '390px', overflowY: 'auto', paddingLeft: '2px' } },
                filteredInsights.slice(0, 25).map((ins) => {
                  const primarySym = (ins.symbols || []).find((s) => s !== 'MACRO') || null;
                  const isVip = ins.authorIsVip || /יגאל|שמחה/i.test(ins.author || '');
                  const vipName = isVip ? (/יגאל/i.test(ins.author) ? '👑 יגאל (סמכות עליונה)' : '👑 שמחה (סמכות עליונה)') : null;
                  return h('div', {
                    class: 'card',
                    style: {
                      background: 'rgba(10, 17, 30, 0.9)',
                      padding: '10px 12px',
                      borderColor: isVip
                        ? 'rgba(245, 158, 11, 0.65)'
                        : ins.bias === 'bullish'
                          ? 'rgba(46, 204, 113, 0.32)'
                          : ins.bias === 'bearish'
                            ? 'rgba(240, 91, 91, 0.32)'
                            : 'rgba(148, 163, 184, 0.22)',
                      boxShadow: isVip ? '0 0 10px rgba(245, 158, 11, 0.15)' : undefined,
                    },
                  },
                    h('div', { class: 'row between wrap', style: { gap: '6px', marginBottom: '6px', alignItems: 'center' } },
                      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
                        h('strong', {
                          style: { fontSize: '12.5px', color: isVip ? '#fbbf24' : '#86efac' },
                          text: isVip ? vipName : `✍️ ${ins.author || 'חבר קבוצה'}`,
                        }),
                        h('span', { class: 'tiny mono muted', text: ins.timestampRaw || '' }),
                        ...(ins.symbols || []).map((s) => tag(s, s === symbol ? 'live' : 'dry')),
                        ...(ins.categories || []).map((c) => tag(CAT_HE[c] || c, 'opt')),
                        ins.bias === 'bullish' ? tag('🟢 שורי', 'live') : ins.bias === 'bearish' ? tag('🔴 דובי', 'red') : null,
                      ),
                      h('div', { class: 'row wrap', style: { gap: '6px' } },
                        primarySym && primarySym !== symbol && typeof onSelectAsset === 'function'
                          ? h('button', {
                              class: 'btn btn-sm btn-ghost',
                              onclick: () => onSelectAsset(primarySym),
                            }, `📊 נתח ${primarySym}`)
                          : null,
                        h('button', {
                          class: 'btn btn-sm',
                          style: { borderColor: isVip ? 'rgba(245, 158, 11, 0.6)' : 'rgba(37, 211, 102, 0.5)', color: isVip ? '#fbbf24' : '#86efac' },
                          onclick: () => openWhatsAppSourceModal(ins, report.groupName),
                        }, `💬 הודעת מקור + קונטקסט (${(ins.contextBefore?.length || 0) + (ins.contextAfter?.length || 0) + 1})`),
                      ),
                    ),
                    h('div', { class: 'small', style: { lineHeight: '1.5', color: '#e2e8f0' }, text: ins.summary }),
                  );
                }),
              )
            : h('div', { class: 'tiny muted', style: { padding: '12px', textAlign: 'center' }, text: 'אין תובנות תואמות לסינון הנוכחי — נסה "הכל" או סרוק שוב את הקבוצה.' }),
        )
      : h('div', {
          class: 'tiny muted',
          style: { padding: '8px 4px', lineHeight: '1.6' },
          text: 'עדיין לא נסרקה קבוצת וואטסאפ. לחץ למעלה על "📱 חבר WhatsApp Web (QR)", בחר את הקבוצה שלך ולחץ "🔍 סרוק קבוצה ושלב בגאן".',
        }),
  );
}
