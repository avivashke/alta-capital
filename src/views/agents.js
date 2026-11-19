import { store } from '../store.js';
import { LLM_PROVIDERS } from '../config.js';
import { PROVIDERS } from '../providers.js';
import { addPoolEntry, poolEntries } from '../keypool.js';
import { testConnection } from '../llm.js';
import { h, num, section, notice, timeAgo, toast, tag } from '../ui.js';
import { feedList } from './shared.js';
import { tick } from '../firm.js';
import { runAiDirector } from '../ai.js';
import { renderEducationalChatWidget } from './academy.js';

const PIPELINE = [
  ['סריקה', 'איסוף אסטרטגיות, קוד ומחקר מ-GitHub, חדשות ומקורות פתוחים'],
  ['מחקר גאן וזמן', 'ניתוח רב-שנתי של נתונים וגרפים: מחזורי זמן, לוח שנה מסחרי, זוויות/רמות גאן ודפוסים חוזרים'],
  ['בקטסט', 'הרצה על נתוני עבר עם עמלות, walk-forward וניהול סיכון'],
  ['אופטימיזציה', 'כיול מתמטי: grid/random search, hill-climb ו-Walk-Forward'],
  ['שערי סיכון', 'PF, DD, יציבות, OOS, expectancy ומספר עסקאות מינימלי'],
  ['גרסה/רובוט', 'אריזת קוד, יצירת רובוט חדש או עדכון קיים לאסטרטגיות שעברו אימות'],
  ['dry-run', 'הרצה על נייר בזמן אמת לאימות לפני קידום'],
  ['חי על נייר', 'מעקב ביצועים, ניתוח סטיות והמשך מיטוב רציף'],
];

// Defined Mission Spaces (Zones) with well-separated workstation slots so agents never overlap
const MISSION_ZONES = {
  research: {
    id: 'research',
    label: 'מרחב מחקר ומודיעין',
    short: 'מחקר',
    icon: '⌁',
    bounds: { x1: 6, y1: 14, x2: 43, y2: 44 },
    slots: [
      { x: 14, y: 23 },
      { x: 28, y: 22 },
      { x: 40, y: 24 },
      { x: 20, y: 40 },
    ],
  },
  gann: {
    id: 'gann',
    label: 'מעבדת גאן ומחזורי זמן',
    short: 'גאן',
    icon: '◬',
    bounds: { x1: 57, y1: 14, x2: 94, y2: 44 },
    slots: [
      { x: 60, y: 22 },
      { x: 75, y: 21 },
      { x: 89, y: 24 },
      { x: 67, y: 39 },
      { x: 83, y: 40 },
    ],
  },
  quant: {
    id: 'quant',
    label: 'מרחב קוונטים, בקטסט ואופטימיזציה',
    short: 'קוונטים',
    icon: '⚗',
    bounds: { x1: 6, y1: 56, x2: 43, y2: 88 },
    slots: [
      { x: 14, y: 65 },
      { x: 30, y: 63 },
      { x: 15, y: 84 },
      { x: 31, y: 85 },
      { x: 42, y: 74 },
    ],
  },
  ops: {
    id: 'ops',
    label: 'מרחב פיקוד, סיכון וביצוע',
    short: 'ביצוע וסיכון',
    icon: '🛡',
    bounds: { x1: 57, y1: 56, x2: 94, y2: 88 },
    slots: [
      { x: 60, y: 64 },
      { x: 76, y: 63 },
      { x: 89, y: 66 },
      { x: 66, y: 84 },
      { x: 83, y: 85 },
    ],
  },
  nexus: {
    id: 'nexus',
    label: 'צומת תיאום ומפגשי משימה',
    short: 'צומת תיאום',
    icon: '✦',
    bounds: { x1: 42, y1: 42, x2: 58, y2: 58 },
    slots: [
      { x: 43, y: 48 },
      { x: 57, y: 48 },
    ],
  },
};

// Task-driven cross-zone mission workflows: agents travel from their home zone to another zone to collaborate on a task!
const TASK_MISSIONS = [
  {
    a: 'gann_square', b: 'quant',
    zone: 'quant',
    taskTitle: 'הטמעת רמות Square of 9 באסטרטגיית הקוונט',
    turns: [
      { speaker: 'a', text: 'נועה, הגעתי ממעבדת גאן עם רמות 90° ו-180° ב-Square of 9 לשולחן ה-1h.' },
      { speaker: 'b', text: 'גלעד, משלבת אותן עכשיו כיעדי כניסה ו-Take Profit במודל ה-EMA Trend!' },
      { speaker: 'a', text: 'מעולה, חוזר למעבדת גאן לעדכן את מפת הרמות לנר הבא.' },
    ],
  },
  {
    a: 'intel', b: 'optimizer',
    zone: 'research',
    taskTitle: 'העברת אלגוריתם פריצת תנודתיות מ-GitHub לכיול',
    turns: [
      { speaker: 'a', text: 'ליה, סרקתי ב-GitHub אסטרטגיית Volatility Breakout עם יחס יעילות (ER).' },
      { speaker: 'b', text: 'עומר, לקחתי את הפרמטרים — אני חוזרת למרחב הקוונטים להריץ עליהם Hill-Climb!' },
    ],
  },
  {
    a: 'backtest', b: 'risk',
    zone: 'ops',
    taskTitle: 'בדיקת שערי סיכון ו-Walk-Forward לפני קידום גרסה',
    turns: [
      { speaker: 'a', text: 'דניאל, הגעתי ממרחב הבקטסט: השולחן היומי עבר Walk-Forward עם OOS של +4.2%.' },
      { speaker: 'b', text: 'איתי, בדקתי בחדר הסיכונים — ה-Drawdown הוא 11% וה-Profit Factor 1.45. מאושר!' },
    ],
  },
  {
    a: 'gann_time', b: 'ta',
    zone: 'gann',
    taskTitle: 'הצלבת מחזור זמן 144 נרות עם מומנטום RSI/MACD',
    turns: [
      { speaker: 'a', text: 'יעל, חלון הזמן של 144 נרות ב-BTC נפתח עכשיו במעבדת גאן.' },
      { speaker: 'b', text: 'גדעון, הניתוח הטכני מאשר: RSI יוצא ממכירת-יתר ו-MACD חוצה למעלה!' },
    ],
  },
  {
    a: 'cio', b: 'dev',
    zone: 'nexus',
    taskTitle: 'אישור CIO ואריזת קוד רובוט Freqtrade + Pine Script',
    turns: [
      { speaker: 'a', text: 'גיא, בצומת הפיקוד: אשרתי את הגרסה החדשה. תארוז קוד רובוט ותשמור בדאטה-בייס.' },
      { speaker: 'b', text: 'אוריה, הקוד נארז ל-Freqtrade ו-Pine Script ונסנכרן מול Netlify DB!' },
    ],
  },
  {
    a: 'gann_master', b: 'exec',
    zone: 'ops',
    taskTitle: 'עדכון יעדי מסחר נייר חי לפי מניפת זוויות גאן',
    turns: [
      { speaker: 'a', text: 'תמר, הבאתי ממעבדת גאן את זווית ה-1x1 החדשה להגנה על הפוזיציה הפתוחה.' },
      { speaker: 'b', text: 'גנית, עדכנתי את הסטופ הדינמי בתיק הנייר בהתאם לזווית ול-ATR!' },
    ],
  },
];

function homeZoneFor(agentId = '') {
  if (agentId === 'intel') return 'research';
  if (agentId.startsWith('gann')) return 'gann';
  if (['quant', 'backtest', 'optimizer', 'ta'].includes(agentId)) return 'quant';
  return 'ops';
}

//Determine which zone an agent should move to based on their active task text
function taskZoneFor(agent) {
  const id = agent.id || '';
  const txt = `${agent.task || ''} ${agent.speech || ''} ${agent.thinking || ''}`.toLowerCase();
  if (agent.status === 'busy') {
    if (/סיכון|dd|drawdown|ביצוע|dry-run|אורז|פיתוח|רובוט|מאשר|הון/.test(txt)) return 'ops';
    if (/walk-forward|בקטסט|וריאציות|פרמטרים|hill-climb|מונטה|מגמה|מומנטום/.test(txt)) return 'quant';
    if (/גאן|ריבוע התשע|זוויות|מחזורי זמן|תבניות/.test(txt)) return 'gann';
    if (/github|חדשות|סורק|מודיעין|סנטימנט/.test(txt)) return 'research';
  }
  return homeZoneFor(id);
}

const sim = {
  nodes: new Map(),
  meetings: [],
  rafId: null,
  lastTs: 0,
  lastMeetSpawn: 0,
  stageEl: null,
  svgEl: null,
  showProxyPanel: false,
};

function slotCoordsInZone(zoneId, slotIdx) {
  const z = MISSION_ZONES[zoneId] || MISSION_ZONES.research;
  const pt = z.slots[slotIdx % z.slots.length];
  return { x: pt.x, y: pt.y };
}

function assignZoneSlots() {
  // Group non-meeting nodes by their targetZoneId and assign each a distinct slot inside that zone
  const byZone = { research: [], gann: [], quant: [], ops: [], nexus: [] };
  for (const n of sim.nodes.values()) {
    if (n.state === 'roaming') {
      const zid = n.targetZoneId || n.homeZoneId || 'research';
      (byZone[zid] || byZone.research).push(n);
    }
  }
  for (const [zid, list] of Object.entries(byZone)) {
    list.forEach((n, idx) => {
      const pt = slotCoordsInZone(zid, idx + (n.slotOffset || 0));
      n.tx = pt.x;
      n.ty = pt.y;
    });
  }
}

function ensureSimNodes(agents) {
  const zoneCounts = { research: 0, gann: 0, quant: 0, ops: 0 };
  agents.forEach((a, idx) => {
    const hZone = homeZoneFor(a.id);
    const sIdx = zoneCounts[hZone] || 0;
    zoneCounts[hZone] = sIdx + 1;
    if (!sim.nodes.has(a.id)) {
      const homePt = slotCoordsInZone(hZone, sIdx);
      sim.nodes.set(a.id, {
        id: a.id,
        homeZoneId: hZone,
        currentZoneId: hZone,
        targetZoneId: hZone,
        slotOffset: sIdx,
        x: homePt.x,
        y: homePt.y,
        tx: homePt.x,
        ty: homePt.y,
        vx: 0,
        vy: 0,
        face: idx % 2 === 0 ? 1 : -1,
        state: 'roaming',
        meetingId: null,
        seatSide: 0,
        missionLabel: MISSION_ZONES[hZone]?.short || 'מחקר',
        speechText: a.speech || a.thinking || a.task || a.focus || 'מוכן למשימה במרחב',
        speechKind: 'speak',
        isSpeakingNow: false,
        pauseUntil: 0,
        el: null,
        bubbleEl: null,
        bubbleTextEl: null,
        bubbleKindEl: null,
        zoneBadgeEl: null,
      });
    } else {
      // Sync live task zone from store.state.agents
      const node = sim.nodes.get(a.id);
      if (node.state === 'roaming') {
        const desiredZone = taskZoneFor(a);
        if (desiredZone && desiredZone !== node.targetZoneId) {
          node.targetZoneId = desiredZone;
        }
      }
    }
  });
  assignZoneSlots();
}

export function spawnMeeting(forcedZoneId = null, customCenter = null) {
  if (sim.meetings.length >= 2 && !customCenter && !forcedZoneId) return;
  if ((customCenter || forcedZoneId) && sim.meetings.length >= 2) {
    endMeeting(sim.meetings[0]);
  }

  const freeNodes = [...sim.nodes.values()].filter((n) => n.state === 'roaming');
  if (freeNodes.length < 2) return;

  const shuffled = [...TASK_MISSIONS].sort(() => Math.random() - 0.5);
  let mission = shuffled.find((m) => {
    if (forcedZoneId && m.zone !== forcedZoneId) return false;
    const na = sim.nodes.get(m.a);
    const nb = sim.nodes.get(m.b);
    return na && nb && na.state === 'roaming' && nb.state === 'roaming';
  }) || shuffled.find((m) => {
    const na = sim.nodes.get(m.a);
    const nb = sim.nodes.get(m.b);
    return na && nb && na.state === 'roaming' && nb.state === 'roaming';
  });

  let nodeA;
  let nodeB;
  if (mission) {
    nodeA = sim.nodes.get(mission.a);
    nodeB = sim.nodes.get(mission.b);
  } else {
    nodeA = freeNodes[0];
    nodeB = freeNodes[1];
    mission = TASK_MISSIONS[0];
  }
  if (!nodeA || !nodeB) return;

  const targetZoneId = forcedZoneId || mission.zone || 'nexus';
  const z = MISSION_ZONES[targetZoneId] || MISSION_ZONES.nexus;

  // Pick a meeting spot inside the target Mission Zone
  const hasLeftMeeting = sim.meetings.some((m) => m.mx < 50);
  let mx = customCenter ? customCenter.x : ((z.bounds.x1 + z.bounds.x2) / 2);
  let my = customCenter ? customCenter.y : ((z.bounds.y1 + z.bounds.y2) / 2 + 3);
  if (!customCenter && !forcedZoneId && hasLeftMeeting && mx < 50) {
    const rightZone = MISSION_ZONES.ops;
    mx = (rightZone.bounds.x1 + rightZone.bounds.x2) / 2;
    my = (rightZone.bounds.y1 + rightZone.bounds.y2) / 2;
  }

  const meetId = 'meet_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const meeting = {
    id: meetId,
    aId: nodeA.id,
    bId: nodeB.id,
    zoneId: targetZoneId,
    mx,
    my,
    topic: mission.taskTitle,
    turns: mission.turns,
    turnIndex: 0,
    phase: 'approaching',
    nextTurnAt: 0,
    startedAt: Date.now(),
  };

  nodeA.state = 'walking-to-meet';
  nodeA.meetingId = meetId;
  nodeA.targetZoneId = targetZoneId;
  nodeA.seatSide = -1;
  nodeA.tx = Math.max(12, mx - 6.8);
  nodeA.ty = my;

  nodeB.state = 'walking-to-meet';
  nodeB.meetingId = meetId;
  nodeB.targetZoneId = targetZoneId;
  nodeB.seatSide = 1;
  nodeB.tx = Math.min(88, mx + 6.8);
  nodeB.ty = my;

  sim.meetings.push(meeting);
}

function endMeeting(meeting) {
  const nodeA = sim.nodes.get(meeting.aId);
  const nodeB = sim.nodes.get(meeting.bId);
  for (const n of [nodeA, nodeB]) {
    if (!n) continue;
    n.state = 'roaming';
    n.meetingId = null;
    n.seatSide = 0;
    n.isSpeakingNow = false;
    // Return to home mission zone or next pipeline zone
    n.targetZoneId = n.homeZoneId;
    n.slotOffset = (n.slotOffset + 1) % 4;
  }
  sim.meetings = sim.meetings.filter((m) => m.id !== meeting.id);
  assignZoneSlots();
}

function detectZoneAt(x, y) {
  for (const z of Object.values(MISSION_ZONES)) {
    if (x >= z.bounds.x1 - 4 && x <= z.bounds.x2 + 4 && y >= z.bounds.y1 - 4 && y <= z.bounds.y2 + 4) {
      return z.id;
    }
  }
  return 'nexus';
}

function stepPhysics(now) {
  if (!sim.stageEl || !document.body.contains(sim.stageEl)) {
    sim.rafId = null;
    return;
  }
  const dt = Math.min(0.05, (now - (sim.lastTs || now)) / 1000 || 0.016);
  sim.lastTs = now;

  if (sim.meetings.length < 2 && now - sim.lastMeetSpawn > 2000) {
    sim.lastMeetSpawn = now;
    spawnMeeting();
  }

  for (const m of [...sim.meetings]) {
    const na = sim.nodes.get(m.aId);
    const nb = sim.nodes.get(m.bId);
    if (!na || !nb) {
      endMeeting(m);
      continue;
    }
    const distA = Math.hypot(na.tx - na.x, na.ty - na.y);
    const distB = Math.hypot(nb.tx - nb.x, nb.ty - nb.y);
    const zShort = MISSION_ZONES[m.zoneId]?.short || 'משימה';

    if (m.phase === 'approaching') {
      na.speechKind = 'walk';
      nb.speechKind = 'walk';
      na.speechText = `עובר למרחב ${zShort}: ${m.topic}`;
      nb.speechText = `עובר למרחב ${zShort}: ${m.topic}`;
      if ((distA < 2.2 && distB < 2.2) || now - m.startedAt > 10000) {
        m.phase = 'talking';
        m.turnIndex = 0;
        m.nextTurnAt = now + 3600;
        na.state = 'meeting';
        nb.state = 'meeting';
      }
    }

    if (m.phase === 'talking') {
      na.face = na.x <= nb.x ? 1 : -1;
      nb.face = nb.x >= na.x ? -1 : 1;

      const turn = m.turns[m.turnIndex];
      if (!turn) {
        endMeeting(m);
        continue;
      }
      if (turn.speaker === 'a') {
        na.isSpeakingNow = true;
        na.speechKind = 'speak';
        na.speechText = turn.text;
        nb.isSpeakingNow = false;
        nb.speechKind = 'think';
        nb.speechText = `מקשיב במרחב ${zShort}: "${m.topic}"`;
      } else {
        nb.isSpeakingNow = true;
        nb.speechKind = 'speak';
        nb.speechText = turn.text;
        na.isSpeakingNow = false;
        na.speechKind = 'think';
        na.speechText = `מקשיב במרחב ${zShort}: "${m.topic}"`;
      }

      if (now >= m.nextTurnAt) {
        m.turnIndex++;
        m.nextTurnAt = now + 3600;
        if (m.turnIndex >= m.turns.length) {
          endMeeting(m);
        }
      }
    }
  }

  const allNodes = [...sim.nodes.values()];

  for (const n of allNodes) {
    if (n.state === 'meeting') {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    if (n.pauseUntil > now) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }

    const dx = n.tx - n.x;
    const dy = n.ty - n.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 1.3) {
      if (n.state === 'roaming') {
        n.pauseUntil = now + 1800 + Math.random() * 2000;
        n.slotOffset = (n.slotOffset + 1) % 4;
        const pt = slotCoordsInZone(n.targetZoneId || n.homeZoneId, n.slotOffset);
        n.tx = pt.x;
        n.ty = pt.y;
      }
      n.vx = 0;
      n.vy = 0;
    } else {
      const speed = n.state === 'walking-to-meet' ? 12.0 : 6.2;
      n.vx = (dx / dist) * speed;
      n.vy = (dy / dist) * speed;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (Math.abs(n.vx) > 0.25) {
        n.face = n.vx >= 0 ? 1 : -1;
      }
    }
  }

  // Hard Pairwise Character Separation (6 relaxation passes -> 0% bounding-box overlap!)
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        const sameMeeting = a.meetingId && a.meetingId === b.meetingId;
        const minW = sameMeeting ? 12.5 : 16.5;
        const minH = sameMeeting ? 6.0 : 19.5;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
          dx = (i % 2 === 0 ? 1 : -1) * 0.5;
          dy = (j % 2 === 0 ? 1 : -1) * 0.5;
        }
        const normDist = Math.hypot(dx / minW, dy / minH);
        if (normDist < 1) {
          const push = (1 - normDist) * 0.52;
          const ux = (dx / minW) / normDist;
          const uy = (dy / minH) / normDist;
          a.x -= ux * minW * push;
          a.y -= uy * minH * push;
          b.x += ux * minW * push;
          b.y += uy * minH * push;
        }
      }
    }
    for (const n of allNodes) {
      n.x = Math.max(9, Math.min(91, n.x));
      n.y = Math.max(18, Math.min(90, n.y));
    }
  }

  for (const n of allNodes) {
    if (!n.el) continue;
    n.currentZoneId = detectZoneAt(n.x, n.y);
    const curZ = MISSION_ZONES[n.currentZoneId]?.short || 'במעבר';
    const tgtZ = MISSION_ZONES[n.targetZoneId]?.short || curZ;
    const zoneLabel = curZ !== tgtZ ? `📍 ${curZ} ← ${tgtZ}` : `📍 ${curZ}`;

    const isWalking = Math.hypot(n.vx, n.vy) > 0.3 && n.state !== 'meeting';
    const showBubble = !!n.isSpeakingNow;
    n.el.style.left = `${n.x.toFixed(2)}%`;
    n.el.style.top = `${n.y.toFixed(2)}%`;
    n.el.style.zIndex = String(showBubble ? 95 : (10 + Math.round(n.y)));
    n.el.style.setProperty('--face', String(n.face));

    n.el.classList.toggle('is-walking', isWalking);
    n.el.classList.toggle('is-meeting', n.state === 'meeting');
    n.el.classList.toggle('is-speaking', showBubble);

    if (n.bubbleEl) {
      n.bubbleEl.className = `bot3d-bubble ${n.speechKind} ${showBubble ? 'is-expanded' : 'is-silent'}`;
    }
    if (n.bubbleTextEl && n.bubbleTextEl.textContent !== n.speechText) {
      n.bubbleTextEl.textContent = n.speechText;
    }
    if (n.bubbleKindEl) {
      const kText = n.state === 'meeting'
        ? `💬 משימה במרחב ${tgtZ}`
        : `🚶 בדרך למרחב ${tgtZ}`;
      if (n.bubbleKindEl.textContent !== kText) n.bubbleKindEl.textContent = kText;
    }
    if (n.zoneBadgeEl && n.zoneBadgeEl.textContent !== zoneLabel) {
      n.zoneBadgeEl.textContent = zoneLabel;
    }
  }

  if (sim.svgEl) {
    sim.svgEl.innerHTML = '';
    for (const m of sim.meetings) {
      const na = sim.nodes.get(m.aId);
      const nb = sim.nodes.get(m.bId);
      if (!na || !nb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', `${na.x}%`);
      line.setAttribute('y1', `${na.y}%`);
      line.setAttribute('x2', `${nb.x}%`);
      line.setAttribute('y2', `${nb.y}%`);
      line.setAttribute('stroke', m.phase === 'talking' ? '#2ecc71' : '#00e5ff');
      line.setAttribute('stroke-width', m.phase === 'talking' ? '2.5' : '1.5');
      line.setAttribute('stroke-dasharray', m.phase === 'talking' ? '6,4' : '3,6');
      line.setAttribute('class', 'meet-beam-line');
      sim.svgEl.appendChild(line);

      const cx = (na.x + nb.x) / 2;
      const cy = (na.y + nb.y) / 2;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', `${cx}%`);
      circle.setAttribute('cy', `${cy}%`);
      circle.setAttribute('r', m.phase === 'talking' ? '6' : '4');
      circle.setAttribute('fill', m.phase === 'talking' ? '#2ecc71' : '#00e5ff');
      sim.svgEl.appendChild(circle);
    }
  }

  sim.rafId = requestAnimationFrame(stepPhysics);
}

function startArenaLoop() {
  if (sim.rafId) cancelAnimationFrame(sim.rafId);
  sim.lastTs = performance.now();
  if (sim.meetings.length === 0) {
    spawnMeeting('quant');
    spawnMeeting('ops');
  }
  sim.rafId = requestAnimationFrame(stepPhysics);
}

export function dispatchTeamToZone(zoneId) {
  for (const m of [...sim.meetings]) endMeeting(m);
  const all = [...sim.nodes.values()];
  all.forEach((n, idx) => {
    if (idx < 4) n.targetZoneId = zoneId;
    else n.targetZoneId = n.homeZoneId;
  });
  assignZoneSlots();
  spawnMeeting(zoneId);
}

function build3DArena(agents) {
  ensureSimNodes(agents);

  const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgOverlay.setAttribute('class', 'arena3d-svg-links');
  sim.svgEl = svgOverlay;

  const botEls = agents.map((agent) => {
    const node = sim.nodes.get(agent.id);
    const kindEl = h('span', { class: 'bub-status', text: '💬 משימה' });
    const textEl = h('div', { class: 'bub-msg', text: node.speechText });
    const bubbleEl = h('div', { class: 'bot3d-bubble speak is-silent' },
      h('div', { class: 'bub-head' },
        kindEl,
        h('span', { class: 'voice-wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      ),
      textEl,
    );
    const zoneBadgeEl = h('div', { class: 'bot3d-zone-badge', text: `📍 ${MISSION_ZONES[node.homeZoneId]?.short || 'מחקר'}` });

    const figureEl = h('div', { class: 'bot3d-figure' },
      h('div', { class: 'bot3d-head' },
        h('div', { class: 'head-top-plane' }),
        h('div', { class: 'head-antenna' }),
        h('div', { class: 'head-visor' },
          h('span', { class: 'visor-eye' }),
          h('span', { class: 'visor-eye' }),
        ),
        h('div', { class: 'head-mouth' }),
      ),
      h('div', { class: 'bot3d-neck' }),
      h('div', { class: 'bot3d-torso' },
        h('div', { class: 'shoulder left' }),
        h('div', { class: 'shoulder right' }),
        h('div', { class: 'chest-plate' },
          h('div', { class: 'reactor-core' }, h('span', { text: agent.icon || '✦' })),
        ),
      ),
      h('div', { class: 'bot3d-arm left' }, h('div', { class: 'hand-glow' })),
      h('div', { class: 'bot3d-arm right' }, h('div', { class: 'hand-glow' })),
      h('div', { class: 'bot3d-leg left' }, h('div', { class: 'boot' })),
      h('div', { class: 'bot3d-leg right' }, h('div', { class: 'boot' })),
    );

    const el = h('div', {
      class: 'bot3d',
      style: { left: `${node.x}%`, top: `${node.y}%` },
      onclick: (e) => {
        e.stopPropagation();
        spawnMeeting(node.currentZoneId, { x: Math.max(18, Math.min(82, node.x)), y: Math.max(24, Math.min(82, node.y)) });
        toast(`${agent.name} פותח ישיבת משימה במרחב ${MISSION_ZONES[node.currentZoneId]?.label || ''}!`, 'ok');
      },
    },
      bubbleEl,
      h('div', { class: 'bot3d-body-wrap' },
        h('div', { class: 'bot3d-pedestal' },
          h('div', { class: 'pedestal-ring' }),
          h('div', { class: 'pedestal-shadow' }),
        ),
        figureEl,
      ),
      h('div', { class: 'bot3d-nameplate' },
        h('div', {},
          h('b', { text: agent.name }),
          h('span', { text: agent.role }),
        ),
        zoneBadgeEl,
      ),
    );

    node.el = el;
    node.bubbleEl = bubbleEl;
    node.bubbleTextEl = textEl;
    node.bubbleKindEl = kindEl;
    node.zoneBadgeEl = zoneBadgeEl;
    return el;
  });

  const stage = h('div', {
    class: 'arena3d-stage',
    onclick: (e) => {
      const rect = stage.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * 100;
      const clickY = ((e.clientY - rect.top) / rect.height) * 100;
      const zId = detectZoneAt(clickX, clickY);
      spawnMeeting(zId, {
        x: Math.max(18, Math.min(82, clickX)),
        y: Math.max(24, Math.min(82, clickY)),
      });
      toast(`צוות משימה נשלח ל-${MISSION_ZONES[zId]?.label || 'נקודת המפגש'}!`, 'ok');
    },
  },
    h('div', { class: 'arena3d-floor-plane' },
      h('div', { class: 'floor-grid-3d' }),
      h('div', { class: 'plaza-zone plaza-research' },
        h('span', { class: 'plaza-watermark', text: '⌁ מרחב 1: מחקר, GitHub ומודיעין' }),
      ),
      h('div', { class: 'plaza-zone plaza-gann' },
        h('span', { class: 'plaza-watermark', text: '◬ מרחב 2: מעבדת גאן, ריבוע התשע ומחזורי זמן' }),
      ),
      h('div', { class: 'plaza-zone plaza-quant' },
        h('span', { class: 'plaza-watermark', text: '⚗ מרחב 3: קוונטים, בקטסט Walk-Forward ואופטימיזציה' }),
      ),
      h('div', { class: 'plaza-zone plaza-ops' },
        h('span', { class: 'plaza-watermark', text: '🛡 מרחב 4: פיקוד CIO, שערי סיכון וביצוע רובוטים' }),
      ),
      h('div', { class: 'nexus-core-3d' },
        h('div', { class: 'nexus-ring r1' }),
        h('div', { class: 'nexus-ring r2' }),
        h('div', { class: 'nexus-ring r3' }),
        h('div', { class: 'nexus-orb' }),
        h('div', { class: 'nexus-caption', text: 'צומת תיאום משימות · מעבר בין מרחבים' }),
      ),
    ),
    svgOverlay,
    ...botEls,
  );

  sim.stageEl = stage;
  setTimeout(startArenaLoop, 30);
  return stage;
}

function renderQuickProxyApiPanel(ui) {
  const s = store.state.settings;
  const proxyUrlIn = h('input', {
    type: 'url',
    value: s.cloudflareProxyUrl || 'https://alta-groq.avivashke95.workers.dev/v1',
    placeholder: 'https://your-worker.workers.dev/v1',
    dir: 'ltr',
  });
  const proxyModelIn = h('input', {
    type: 'text',
    value: s.cloudflareProxyModel || 'openai/gpt-oss-120b',
    placeholder: 'openai/gpt-oss-120b',
    dir: 'ltr',
  });
  const proxyKeyIn = h('input', {
    type: 'password',
    value: s.cloudflareProxyKey || '',
    placeholder: 'טוקן לפרוקסי (אופציונלי)',
    dir: 'ltr',
  });

  const apiProviderSel = h('select', {}, Object.entries(LLM_PROVIDERS).map(([k, p]) =>
    h('option', { value: k, selected: (s.llm?.provider || 'groq') === k }, p.label)
  ));
  const apiKeyIn = h('input', {
    type: 'password',
    value: s.llm?.apiKey || '',
    placeholder: 'הדבק מפתח API (gsk_... / AIza... / sk-...)',
    dir: 'ltr',
  });
  const apiModelIn = h('input', {
    type: 'text',
    value: s.llm?.model || 'llama-3.3-70b-versatile',
    placeholder: 'שם מודל (למשל llama-3.3-70b-versatile)',
    dir: 'ltr',
  });

  const activeCount = poolEntries(store.state).length;

  return h('div', { class: 'card', style: { marginBottom: '14px', borderColor: 'rgba(0, 229, 255, 0.4)' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '🔌 הגדרת פרוקסי (Cloudflare Worker) וחיבורי API לסוכנים' }),
        h('div', { class: 'card-sub', text: 'הגדר או הוסף כתובת פרוקסי ומפתחות API ישירות מכאן — הכל נשמר אוטומטית בבריכת המודלים ובדאטה-בייס' }),
      ),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag(`${activeCount} חיבורים בבריכה`, 'live'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('settings') }, 'הגדרות מלאות ⚙'),
      ),
    ),
    h('div', { class: 'grid cols-2', style: { gap: '14px' } },
      h('div', { class: 'card', style: { background: 'rgba(8, 14, 23, 0.85)' } },
        h('h3', { style: { color: '#7dd3fc', marginBottom: '8px' }, text: '1. פרוקסי Cloudflare Worker' }),
        h('div', { class: 'form-grid' },
          h('div', { class: 'full' }, h('label', { class: 'field' }, 'כתובת Worker Proxy (URL)', proxyUrlIn)),
          h('label', { class: 'field' }, 'מודל הפרוקסי', proxyModelIn),
          h('label', { class: 'field' }, 'מפתח פרוקסי (אופציונלי)', proxyKeyIn),
        ),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
          h('button', {
            class: 'btn btn-sm btn-primary',
            onclick: () => {
              const url = proxyUrlIn.value.trim();
              if (!url) { toast('הזן כתובת פרוקסי תקפה', 'bad'); return; }
              store.mutate((st) => {
                st.settings.cloudflareProxyUrl = url;
                st.settings.cloudflareProxyModel = proxyModelIn.value.trim() || 'openai/gpt-oss-120b';
                st.settings.cloudflareProxyKey = proxyKeyIn.value.trim();
              });
              addPoolEntry(store.state, {
                provider: 'gateway',
                baseUrl: url,
                model: proxyModelIn.value.trim() || 'openai/gpt-oss-120b',
                key: proxyKeyIn.value.trim(),
                label: 'Cloudflare Worker Proxy',
              });
              store.save(true);
              toast('פרוקסי Cloudflare נשמר ונוסף לבריכה!', 'ok');
              ui.rerender();
            },
          }, 'שמור והוסף פרוקסי'),
        ),
      ),

      h('div', { class: 'card', style: { background: 'rgba(8, 14, 23, 0.85)' } },
        h('h3', { style: { color: '#4ade80', marginBottom: '8px' }, text: '2. חיבור API ישיר והוספה לבריכת המודלים' }),
        h('div', { class: 'form-grid' },
          h('label', { class: 'field' }, 'ספק API', apiProviderSel),
          h('label', { class: 'field' }, 'שם מודל', apiModelIn),
          h('div', { class: 'full' }, h('label', { class: 'field' }, 'מפתח API (API Key / Token)', apiKeyIn)),
        ),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
          h('button', {
            class: 'btn btn-sm btn-primary',
            onclick: () => {
              const prov = apiProviderSel.value;
              const key = apiKeyIn.value.trim();
              const mod = apiModelIn.value.trim() || PROVIDERS[prov]?.models?.[0] || 'gpt-4o-mini';
              if (!key && prov !== 'ollama') { toast('הזן מפתח API', 'bad'); return; }
              store.mutate((st) => {
                st.settings.llm = {
                  ...(st.settings.llm || {}),
                  provider: prov,
                  baseUrl: LLM_PROVIDERS[prov]?.baseUrl || PROVIDERS[prov]?.baseUrl || 'https://api.openai.com/v1',
                  model: mod,
                  apiKey: key,
                };
              });
              addPoolEntry(store.state, {
                provider: prov in PROVIDERS ? prov : 'custom',
                baseUrl: LLM_PROVIDERS[prov]?.baseUrl || PROVIDERS[prov]?.baseUrl || '',
                model: mod,
                key,
                label: `API · ${LLM_PROVIDERS[prov]?.label || prov}`,
              });
              store.save(true);
              toast('מפתח ה-API נשמר ונוסף לבריכת המודלים!', 'ok');
              ui.rerender();
            },
          }, 'שמור API והוסף לבריכה'),
          h('button', {
            class: 'btn btn-sm',
            onclick: async () => {
              try {
                const r = await testConnection();
                toast('החיבור ענה: ' + r, 'ok');
              } catch (err) {
                toast('בדיקת החיבור נכשלה: ' + err.message, 'bad');
              }
            },
          }, 'בדוק חיבור עכשיו'),
        ),
      ),
    ),
  );
}

function mount(root, ...children) {
  for (const child of children.flat(6)) {
    if (child == null || child === false) continue;
    root.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return root;
}

export function renderAgents(root, ui) {
  const state = store.state;
  const agents = state.agents || [];

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: '3D Mission Spaces · תנועה בין מרחבי משימה, מפגשים וצ׳אט חינוכי' }),
        h('h1', { text: 'מרחב הצוות התלת־ממדי והאקדמיה' }),
        h('p', { text: 'הסוכנים עוברים בזמן אמת בין 4 מרחבי משימה מוגדרים (מחקר, מעבדת גאן, קוונטים/בקטסט, ופיקוד/ביצוע) וצומת התיאום המרכזי בהתאם למשימה הנוכחית שלהם.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', {
          class: 'btn btn-sm ' + (sim.showProxyPanel ? 'btn-primary' : ''),
          onclick: () => {
            sim.showProxyPanel = !sim.showProxyPanel;
            ui.rerender();
          },
        }, '🔌 הגדרת פרוקסי ו-API'),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => {
            spawnMeeting();
            toast('צוות משימה יצא למפגש תיאום במרחב היעד!', 'ok');
          },
        }, '🤝 הפגש סוכנים למשימה'),
        h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              spawnMeeting('quant');
              await runAiDirector({ useFallback: true }).catch(() => {});
              await tick({ reason: 'manual' });
              ui.rerender();
            } finally {
              btn.disabled = false;
            }
          },
        }, '⚡ הרץ מחזור אופטימיזציה'),
      ),
    ),
  );

  if (sim.showProxyPanel) {
    mount(root, renderQuickProxyApiPanel(ui));
  }

  mount(root, h('div', { class: 'card team3d-card' },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '10px' } },
      h('div', {},
        h('h2', { text: 'זירת המרחבים התלת־ממדית · תנועה מוכוונת משימות' }),
        h('div', { class: 'card-sub', text: 'שלח צוותי משימה לכל מרחב בלחיצה או לחץ ישירות על מרחב ברצפה. תג המיקום על כל סוכן מציג את המרחב הנוכחי ויעד המשימה.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { dispatchTeamToZone('research'); toast('צוות נשלח למרחב מחקר ומודיעין', 'ok'); } }, '⌁ משימת מחקר'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { dispatchTeamToZone('gann'); toast('צוות נשלח למעבדת גאן ומחזורי זמן', 'ok'); } }, '◬ משימת גאן'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { dispatchTeamToZone('quant'); toast('צוות נשלח למרחב קוונטים ובקטסט', 'ok'); } }, '⚗ משימת קוונטים'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { dispatchTeamToZone('ops'); toast('צוות נשלח למרחב פיקוד וביצוע', 'ok'); } }, '🛡 משימת ביצוע'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { dispatchTeamToZone('nexus'); toast('צוות זומן לצומת התיאום המרכזי', 'ok'); } }, '✦ צומת תיאום'),
      ),
    ),
    build3DArena(agents),
  ));

  mount(root, renderEducationalChatWidget(ui, { compact: false }));

  if (!sim.showProxyPanel) {
    mount(root, renderQuickProxyApiPanel(ui));
  }

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('יומן פעילות ומפגשים חי', 'מחקר, מחשבות, אופטימיזציה והחלטות', feedList(state.events, 45)),
    section('צינור עבודה ומדדי תפוקה', 'קצב העבודה של הצוותים',
      h('div', { class: 'grid cols-2', style: { marginBottom: '12px' } },
        stat('מחזורים', num(state.stats.cycles || 0)),
        stat('בקטסטים', num(state.stats.backtests || 0)),
        stat('גרסאות/רובוטים', num(state.stats.deployments || 0)),
        stat('סריקות מחקר', num(state.stats.scans || 0)),
      ),
      h('div', { class: 'grid cols-1' },
        PIPELINE.slice(0, 5).map(([title, desc], i) => h('div', { class: 'agent pipe-step', title: desc },
          h('div', { class: 'av', text: String(i + 1) }),
          h('div', { class: 'grow' }, h('div', { class: 'who', text: title }), h('div', { class: 'small muted', text: desc })),
        )),
      ),
    ),
  ));
}

function stat(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }));
}
