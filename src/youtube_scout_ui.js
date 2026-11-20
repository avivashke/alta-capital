// Dedicated UI for Yonatan ("יונתן" · yt_strategy_scout) — YouTube Gann & Strategy Creator Agent
// Renders both the full research + dedicated bot lab card (in #/research) and a compact Gann strip (in #/gann).

import { store } from './store.js';
import { h, tag, toast, timeAgo } from './ui.js';
import { STRATEGIES } from './strategies.js';
import {
  DEFAULT_TRACKED_CREATORS,
  runYonatanYouTubeScout,
  saveYouTubeCustomQueries,
  getDedicatedBotStage,
} from './youtube_scout.js';
import { spawnDedicatedStrategyBot } from './firm.js';

const ytUi = {
  tab: 'bots', // 'bots' | 'gann' | 'videos'
  scanning: false,
  runningBotId: null,
  customInput: '',
};

export function renderYonatanYouTubeScoutCard(ui, { compact = false } = {}) {
  const state = store.state;
  const report = state.youtubeScout || null;
  const customQueries = Array.isArray(report?.customQueries) ? report.customQueries : [];
  const blueprints = Array.isArray(report?.blueprints) ? report.blueprints : [];
  const gannUpgrades = Array.isArray(report?.gannUpgrades) ? report.gannUpgrades : [];
  const videos = Array.isArray(report?.videos) ? report.videos : [];
  const ytDesks = (state.desks || []).filter((d) => d.source === 'youtube_scout');
  const provenCount = ytDesks.filter((d) => d.status === 'dry-run' || d.status === 'live').length;

  const triggerScan = async (withAi = false) => {
    if (ytUi.scanning) return;
    ytUi.scanning = true;
    ui?.refresh?.();
    try {
      const res = await runYonatanYouTubeScout({ customQueries, force: true, withAi });
      toast(`▶ יונתן סרק ${res.report.totalVideos} סרטונים אמיתיים מיוטיוב והפיק ${res.report.blueprints.length} בלופרינטים לבוטים!`, 'ok');
    } catch (err) {
      toast(`שגיאה בסריקת יוטיוב: ${err.message}`, 'bad');
    } finally {
      ytUi.scanning = false;
      ui?.rerender ? ui.rerender() : ui?.refresh?.();
    }
  };

  const triggerDedicatedBot = async (bp) => {
    if (ytUi.runningBotId) return;
    ytUi.runningBotId = bp.deskId;
    ui?.refresh?.();
    try {
      const res = await spawnDedicatedStrategyBot(bp, { runNow: true, deep: true });
      const d = res.desk;
      const stage = getDedicatedBotStage(d);
      const ret = d?.metrics?.returnPct != null ? ` · תשואה ${d.metrics.returnPct}% · OOS ${d.oosMetrics?.returnPct ?? '—'}% · PF ${d.metrics.profitFactor}` : '';
      toast(`🤖 ${d.label}: ${stage.label}${ret}`, d.status === 'live' || d.status === 'dry-run' ? 'ok' : 'info');
    } catch (err) {
      toast(`שגיאה בהרצת בוט ייעודי: ${err.message}`, 'bad');
    } finally {
      ytUi.runningBotId = null;
      ui?.rerender ? ui.rerender() : ui?.refresh?.();
    }
  };

  // Compact mode for #/gann
  if (compact) {
    const gannBps = blueprints.filter((b) => b.track === 'gann').slice(0, 4);
    return h('div', {
      class: 'card',
      style: {
        marginTop: '14px',
        borderColor: 'rgba(239, 68, 68, 0.35)',
        background: 'linear-gradient(180deg, rgba(28, 14, 22, 0.9), rgba(9, 14, 24, 0.95))',
      },
    },
      h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
        h('div', {},
          h('h2', { text: '▶ יונתן · מחקר סרטוני גאן ביוטיוב ובוטים ייעודיים' }),
          h('div', { class: 'card-sub', text: 'סורק סרטוני W.D. Gann, Michael Jenkins ויוצרי אסטרטגיות (כולל Doug & Silvia), משפר את מודול הגאן ומריץ בוטים ייעודיים עד הוכחת רווחיות' }),
        ),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          h('button', {
            class: 'btn btn-sm btn-primary',
            disabled: ytUi.scanning,
            onclick: () => triggerScan(false),
          }, ytUi.scanning ? '⏳ יונתן סורק יוטיוב…' : '▶ סרוק יוטיוב גאן עכשיו'),
          h('a', { href: '#/research', class: 'btn btn-sm btn-ghost' }, 'פתח מעבדת הבוטים של יונתן ↗'),
        ),
      ),
      gannUpgrades.length
        ? h('div', { class: 'grid cols-2', style: { gap: '8px' } },
            gannUpgrades.slice(0, 4).map((up) => {
              const matchingBp = gannBps.find((b) => b.videoUrl === up.url) || gannBps[0] || null;
              const desk = matchingBp ? (state.desks || []).find((d) => d.id === matchingBp.deskId) : null;
              const stage = getDedicatedBotStage(desk);
              return h('div', { class: 'card', style: { background: 'rgba(10, 17, 30, 0.88)', padding: '10px 12px' } },
                h('div', { class: 'row between wrap', style: { gap: '6px', marginBottom: '4px' } },
                  h('a', { href: up.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#fca5a5', fontWeight: '700', fontSize: '12.5px' } }, `▶ ${up.title.slice(0, 62)}`),
                  tag(up.channel, 'dry'),
                ),
                h('div', { class: 'tiny muted', style: { marginBottom: '6px' }, text: `${up.upgradeNote} · ${up.appliedToModule}` }),
                h('div', { class: 'row between wrap', style: { gap: '6px', alignItems: 'center' } },
                  tag(stage.label, stage.tone),
                  matchingBp
                    ? h('button', {
                        class: 'btn btn-sm btn-ghost',
                        disabled: !!ytUi.runningBotId,
                        onclick: () => triggerDedicatedBot(matchingBp),
                      }, ytUi.runningBotId === matchingBp.deskId ? '⏳ מריץ בקטסט…' : (desk ? '⚡ שפר בוט גאן' : '🤖 פתח בוט גאן ייעודי'))
                    : null,
                ),
              );
            }),
          )
        : h('div', { class: 'tiny muted', text: 'לחץ "▶ סרוק יוטיוב גאן עכשיו" כדי שיונתן ישאב סרטוני W.D. Gann ו-Michael Jenkins ויציג שדרוגים ובוטים ייעודיים.' }),
    );
  }

  // Full Studio Card for #/research
  const customInputEl = h('input', {
    type: 'text',
    value: ytUi.customInput,
    placeholder: 'הוסף יוצר יוטיוב או אסטרטגיה (למשל: "ICT Order Block", "Al Brooks", "Gannzilla")',
    style: { flex: '1', minWidth: '240px' },
    oninput: (e) => { ytUi.customInput = e.target.value; },
  });

  return h('div', {
    class: 'card',
    style: {
      marginTop: '14px',
      borderColor: 'rgba(239, 68, 68, 0.45)',
      background: 'linear-gradient(180deg, rgba(26, 14, 24, 0.94), rgba(9, 14, 24, 0.97))',
    },
  },
    // Header
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: '▶ יונתן · סוכן יוטיוב לגאן, Doug & Silvia ובוטים ייעודיים לאסטרטגיות' }),
        h('div', {
          class: 'card-sub',
          text: 'סורק סרטונים אמיתיים ביוטיוב (W.D. Gann, Michael Jenkins, Doug & Silvia Rumer, TradingLab, BACKTEST THE HYPE), מפיק בלופרינטים ומריץ בוט ייעודי לכל אסטרטגיה עד הוכחת רווחיות ויישום בתיק הנייר',
        }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
        report?.scannedAt ? tag(`נסרק ${timeAgo(report.scannedAt)}`, 'live') : tag('מוכן לסריקה', 'opt'),
        h('button', {
          class: 'btn btn-sm btn-primary',
          style: { background: '#dc2626', borderColor: '#ef4444' },
          disabled: ytUi.scanning,
          onclick: () => triggerScan(false),
        }, ytUi.scanning ? '⏳ יונתן סורק יוטיוב…' : '▶ סרוק יוטיוב עכשיו'),
        h('button', {
          class: 'btn btn-sm',
          disabled: ytUi.scanning,
          onclick: () => triggerScan(true),
        }, '🤖 סרוק + תקציר AI'),
      ),
    ),

    // KPI Summary Strip
    h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '12px' } },
      h('div', { class: 'metric' },
        h('span', { text: 'סרטוני יוטיוב אמיתיים' }),
        h('b', { class: 'mono', text: String(report?.totalVideos || 0) }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: 'בלופרינטים לבוטים' }),
        h('b', { class: 'gold mono', text: String(blueprints.length) }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: 'בוטים ייעודיים פעילים' }),
        h('b', { class: 'mono', text: String(ytDesks.length) }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: 'הוכיחו רווחיות / מיושמים' }),
        h('b', { class: 'green mono', text: String(provenCount) }),
      ),
    ),

    // Tracked Creators + Add Custom Creator Bar
    h('div', {
      style: {
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'rgba(15, 23, 42, 0.72)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        marginBottom: '12px',
      },
    },
      h('div', { class: 'tiny muted', style: { marginBottom: '6px', fontWeight: '700' }, text: 'יוצרים וערוצי מחקר במעקב קבוע של יונתן:' }),
      h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
        ...DEFAULT_TRACKED_CREATORS.map((c) => tag(`${c.track === 'gann' ? '📐' : '🎯'} ${c.name}`, c.track === 'gann' ? 'opt' : 'live')),
        ...customQueries.map((q) => h('button', {
          class: 'btn btn-sm btn-ghost',
          style: { fontSize: '11px', padding: '2px 8px', borderColor: 'rgba(56,189,248,0.4)' },
          title: 'לחץ להסרה מרשימת המעקב',
          onclick: () => {
            saveYouTubeCustomQueries(customQueries.filter((x) => x !== q));
            ui?.rerender ? ui.rerender() : ui?.refresh?.();
          },
        }, `✨ ${q} ✕`)),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        customInputEl,
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const val = (customInputEl.value || '').trim();
            if (val.length < 2) {
              toast('הזן שם יוצר יוטיוב או נושא אסטרטגיה', 'bad');
              return;
            }
            const next = saveYouTubeCustomQueries([...customQueries, val]);
            ytUi.customInput = '';
            toast(`✓ "${val}" נוסף למעקב של יונתן — מריץ סריקה…`, 'ok');
            await runYonatanYouTubeScout({ customQueries: next, force: true, withAi: false })
              .then((r) => toast(`נסרקו ${r.report.totalVideos} סרטונים כולל "${val}"`, 'ok'))
              .catch((e) => toast(e.message, 'bad'));
            ui?.rerender ? ui.rerender() : ui?.refresh?.();
          },
        }, '+ הוסף יוצר וסרוק'),
      ),
    ),

    // AI Digest (if generated)
    report?.aiDigest?.text
      ? h('div', {
          class: 'notice ok',
          style: { marginBottom: '12px', whiteSpace: 'pre-wrap', lineHeight: '1.58', fontSize: '12.5px' },
          text: `🤖 תקציר מחקר יוטיוב של יונתן (${report.aiDigest.model || 'AI'}):\n${report.aiDigest.text}`,
        })
      : null,

    // Tabs
    h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px' } },
      ...[
        { id: 'bots', label: `🤖 בוטים ייעודיים והוכחת רווחיות (${blueprints.length})` },
        { id: 'gann', label: `📐 שדרוגי מודול גאן מיוטיוב (${gannUpgrades.length})` },
        { id: 'videos', label: `🎬 כל הסרטונים שנסרקו (${videos.length})` },
      ].map((t) => h('button', {
        class: `btn btn-sm ${ytUi.tab === t.id ? 'btn-primary' : 'btn-ghost'}`,
        onclick: () => {
          ytUi.tab = t.id;
          ui?.rerender ? ui.rerender() : ui?.refresh?.();
        },
      }, t.label)),
    ),

    // Tab 1: Dedicated Strategy Bots & Proof of Profitability Pipeline
    ytUi.tab === 'bots'
      ? (blueprints.length
          ? h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {},
                  h('th', { text: 'יוצר וסרטון מקור (YouTube)' }),
                  h('th', { text: 'מנוע אסטרטגיה · נכס' }),
                  h('th', { text: 'שלב הוכחת רווחיות ויישום' }),
                  h('th', { text: 'מדדי בוט אמיתיים (בקטסט / OOS / PF)' }),
                  h('th', { text: 'פעולה' }),
                )),
                h('tbody', {}, blueprints.map((bp) => {
                  const desk = (state.desks || []).find((d) => d.id === bp.deskId);
                  const stage = getDedicatedBotStage(desk);
                  const stratLabel = STRATEGIES[bp.strategyId]?.label || bp.strategyId;
                  const isRunning = ytUi.runningBotId === bp.deskId;
                  return h('tr', {},
                    h('td', { class: 'small' },
                      h('div', { style: { fontWeight: '700', color: '#f1f5f9' }, text: `${bp.track === 'gann' ? '📐' : '🎯'} ${bp.creator}` }),
                      h('a', {
                        href: bp.videoUrl,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        class: 'tiny',
                        style: { color: '#fca5a5', display: 'inline-block', marginTop: '2px' },
                      }, `▶ ${bp.videoTitle.slice(0, 68)}${bp.views ? ` (${bp.views})` : ''}`),
                    ),
                    h('td', { class: 'small' },
                      h('div', { text: stratLabel }),
                      h('div', { class: 'tiny muted mono', text: `${bp.symbol} · ${bp.tf} · ${bp.techniqueHe}` }),
                    ),
                    h('td', {},
                      tag(stage.label, stage.tone),
                      desk?.lastAudit
                        ? h('div', { class: 'tiny muted', style: { marginTop: '3px' }, text: `אמיר: ${desk.lastAudit.score}/100${desk.lastAudit.vetoed ? ' (וטו)' : ' (מאושר)'}` })
                        : null,
                    ),
                    h('td', { class: 'mono tiny' },
                      desk?.metrics
                        ? h('div', {},
                            h('div', {
                              class: desk.metrics.returnPct >= 0 ? 'green' : 'red',
                              text: `תשואה: ${desk.metrics.returnPct}% · OOS: ${desk.oosMetrics?.returnPct ?? '—'}%`,
                            }),
                            h('div', {
                              class: 'muted',
                              text: `PF ${desk.metrics.profitFactor} · DD ${desk.metrics.maxDrawdownPct}% · ${desk.metrics.trades} עסקאות`,
                            }),
                          )
                        : h('span', { class: 'muted', text: 'טרם הורץ בקטסט' }),
                    ),
                    h('td', {},
                      h('div', { class: 'row wrap', style: { gap: '4px' } },
                        h('button', {
                          class: `btn btn-sm ${desk ? '' : 'btn-primary'}`,
                          disabled: !!ytUi.runningBotId,
                          onclick: () => triggerDedicatedBot(bp),
                        }, isRunning ? '⏳ מריץ בקטסט…' : (desk ? '⚡ שפר והוכח רווחיות' : '🤖 פתח בוט והוכח רווחיות')),
                        desk?.generatedCode
                          ? h('a', { href: '#/bots', class: 'btn btn-sm btn-ghost' }, '📦 קוד בוט')
                          : null,
                      ),
                    ),
                  );
                })),
              ),
            )
          : h('div', { class: 'tiny muted', style: { padding: '14px', textAlign: 'center' }, text: 'לחץ "▶ סרוק יוטיוב עכשיו" כדי שיונתן יאתר אסטרטגיות של Doug & Silvia, W.D. Gann ו-TradingLab ויכין בלופרינטים לבוטים ייעודיים.' }))
      : null,

    // Tab 2: Gann Module Upgrades from YouTube
    ytUi.tab === 'gann'
      ? (gannUpgrades.length
          ? h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {},
                  h('th', { text: 'סרטון גאן (YouTube)' }),
                  h('th', { text: 'ערוץ' }),
                  h('th', { text: 'טכניקה לשיפור מודול גאן' }),
                  h('th', { text: 'שילוב במערכת' }),
                )),
                h('tbody', {}, gannUpgrades.map((u) => h('tr', {},
                  h('td', { class: 'small' }, h('a', { href: u.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#fca5a5', fontWeight: '600' } }, `▶ ${u.title}`)),
                  h('td', { class: 'tiny muted', text: `${u.channel}${u.views ? ` · ${u.views}` : ''}` }),
                  h('td', { class: 'small', text: u.upgradeNote }),
                  h('td', {}, tag(u.appliedToModule, 'live')),
                ))),
              ),
            )
          : h('div', { class: 'tiny muted', style: { padding: '14px', textAlign: 'center' }, text: 'עדיין לא נסרקו סרטוני גאן — לחץ "▶ סרוק יוטיוב עכשיו".' }))
      : null,

    // Tab 3: All Scanned YouTube Videos
    ytUi.tab === 'videos'
      ? (videos.length
          ? h('div', { style: { display: 'grid', gap: '6px', maxHeight: '380px', overflowY: 'auto' } },
              videos.map((v) => h('div', { class: 'card', style: { background: 'rgba(10, 17, 30, 0.88)', padding: '8px 12px' } },
                h('div', { class: 'row between wrap', style: { gap: '6px' } },
                  h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#93c5fd', fontWeight: '600', fontSize: '12.5px' } }, `▶ ${v.title}`),
                  h('div', { class: 'row wrap', style: { gap: '4px' } },
                    tag(v.track === 'gann' ? '📐 גאן' : '🎯 אסטרטגיות', v.track === 'gann' ? 'opt' : 'live'),
                    tag(v.channel || v.queryTag || 'YouTube', 'dry'),
                    v.duration ? tag(v.duration, 'dry') : null,
                  ),
                ),
                v.snippet ? h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: v.snippet }) : null,
              )),
            )
          : h('div', { class: 'tiny muted', style: { padding: '14px', textAlign: 'center' }, text: 'לחץ "▶ סרוק יוטיוב עכשיו" כדי למשוך סרטונים חיים.' }))
      : null,
  );
}
