// Pure, side-effect-free helpers for FocusFlow.
// Everything here is unit-tested and free of React / DOM / fetch so the app's
// core behaviour (time math, date keys, aggregation, export) can be verified
// in isolation.

/** Local date key `YYYY-MM-DD`. The ONE source of "today" — never mix with
 *  toISOString().slice(0,10) (that is UTC and drifts across the day boundary). */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Seconds -> `mm:ss` (or `h:mm:ss` once an hour is reached). */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Local `HH:MM` timestamp used to label steps / pauses. */
export function nowHM(d = new Date()) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Parse a CSS declaration string into a React style object (camelCased). */
export function parseStyle(str) {
  const out = {};
  if (!str) return out;
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const rawKey = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!rawKey || !val) continue;
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = val;
  }
  return out;
}

/** Seconds attributed to a task, adding the live elapsed only to the current one. */
export function projSeconds(task, curId, elapsed) {
  return (task.totalSec || 0) + (task.id === curId ? (elapsed || 0) : 0);
}

/** { project: seconds } for tasks with any accumulated time. */
export function byProject(tasks, curId, elapsed) {
  const out = {};
  for (const t of tasks) {
    const sec = projSeconds(t, curId, elapsed);
    if (sec > 0) out[t.project] = (out[t.project] || 0) + sec;
  }
  return out;
}

/** Live "today" day-record derived from the current working set. */
export function computeToday(tasks, pauses, curId, elapsed) {
  return {
    date: '今天',
    done: tasks.filter((t) => t.done).length,
    byProj: byProject(tasks, curId, elapsed),
    tasks: tasks.map((t) => ({
      ...t,
      title: t.title,
      project: t.project,
      done: t.done,
      totalSec: projSeconds(t, curId, elapsed),
    })),
    pauses,
  };
}

const dayTotal = (d) => Object.values(d.byProj || {}).reduce((a, b) => a + b, 0);

/** Trend / reason / project analytics over the most recent 7 day-records. */
export function computeAnalytics(days) {
  const window = days.slice(0, 7);
  const trend = [...window].reverse();
  const maxDay = Math.max(...trend.map(dayTotal), 1);
  const totalAll = window.reduce((a, d) => a + dayTotal(d), 0);
  const avgSec = window.length ? Math.round(totalAll / window.length) : 0;

  const reasonCount = {};
  window.forEach((d) => (d.pauses || []).forEach((p) => {
    reasonCount[p.reason] = (reasonCount[p.reason] || 0) + 1;
  }));
  const reasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]);
  const maxReason = reasons.length ? reasons[0][1] : 1;

  const projTotals = {};
  window.forEach((d) => Object.entries(d.byProj || {}).forEach(([p, sec]) => {
    projTotals[p] = (projTotals[p] || 0) + sec;
  }));
  const projEntries = Object.entries(projTotals).sort((a, b) => b[1] - a[1]);
  const maxProj = projEntries.length ? projEntries[0][1] : 1;

  return {
    avgSec,
    maxDay,
    trend: trend.map((d) => ({ day: d, total: dayTotal(d) })),
    reasonStats: reasons.map(([reason, count]) => ({ reason, count, ratio: count / maxReason })),
    projStats: projEntries.map(([name, sec]) => ({ name, sec, ratio: sec / maxProj })),
    insight: reasons.length
      ? `最常見的中斷是「${reasons[0][0]}」（${reasons[0][1]} 次）。可以試著安排固定時段集中處理，減少切換成本。`
      : '這 7 天沒有中斷紀錄。',
  };
}

/** Build the copy-to-AI daily report text. */
export function buildExport({ tasks, pauses, ideas, globalNote, currentId, elapsed, now }) {
  const fmt = fmtTime;
  const byProj = {};
  tasks.forEach((t) => {
    const sec = projSeconds(t, currentId, elapsed);
    if (sec > 0) byProj[t.project] = (byProj[t.project] || 0) + sec;
  });
  const total = Object.values(byProj).reduce((a, b) => a + b, 0);
  const lines = [];
  lines.push('請根據以下今日工作紀錄，幫我整理成一份簡潔的日報（含：今日完成、進行中、遇到的中斷與影響、明日待辦）。用條列式、繁體中文。');
  lines.push('');
  lines.push('# 今日工作紀錄 — ' + now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }));
  lines.push('');
  lines.push('## 任務');
  tasks.forEach((t) => {
    const sec = projSeconds(t, currentId, elapsed);
    lines.push('- [' + (t.done ? '完成' : '進行中') + '] ' + t.title + '（專案：' + t.project + '，工時：' + (sec > 0 ? fmt(sec) : '未計時') + '）');
    if (t.summary) lines.push('    - 做了什麼：' + t.summary);
    if (t.adjust) lines.push('    - 待調整：' + t.adjust);
    (t.steps || []).forEach((st) => lines.push('    - 下一步：' + st.text));
    if (t.note) lines.push('    - 筆記：' + t.note);
  });
  lines.push('');
  lines.push('## 各專案工時（總計 ' + fmt(total) + '）');
  Object.entries(byProj).forEach(([p, sec]) => lines.push('- ' + p + '：' + fmt(sec)));
  lines.push('');
  lines.push('## 中斷紀錄（' + pauses.length + ' 次）');
  if (pauses.length === 0) lines.push('- 無');
  pauses.forEach((p) => lines.push('- ' + p.time + ' ' + p.reason + '（' + p.task + '）'));
  if (ideas.length > 0) {
    lines.push('');
    lines.push('## 今日靈感');
    ideas.forEach((i) => lines.push('- ' + i.text));
  }
  if (globalNote.trim()) {
    lines.push('');
    lines.push('## 筆記');
    lines.push(globalNote.trim());
  }
  return lines.join('\n');
}

/** Build the "turn this idea into staged tasks" prompt. */
export function buildIdeaPrompt(text) {
  return [
    '我有一個還很粗略的 idea，請幫我整理成可以直接執行的任務。要求：',
    '- 內容精簡，不要贅字，每個步驟一句話、動詞開頭',
    '- 幫我分階段（階段一、階段二…），每階段 2-4 個步驟',
    '- 每個步驟要小到 30-60 分鐘內能完成',
    '- 標出第一個可以立刻動手的步驟',
    '- 如果 idea 太模糊，先列出需要我先回答的 1-3 個問題',
    '',
    '輸出格式：',
    '任務名稱：（一句話）',
    '階段一：…',
    '- 步驟',
    '階段二：…',
    '',
    '我的 idea：' + text,
  ].join('\n');
}

/**
 * Non-destructive day rollover. When the stored day differs from the current
 * local day, archive a snapshot of the previous day into history and start a
 * fresh day: completed tasks move into the archive, open tasks carry over with
 * their per-day time reset to 0 (steps/notes preserved), pauses clear.
 * Nothing is deleted — everything lives on in the history snapshot.
 */
export function applyRollover(data, key = todayKey()) {
  if (!data.activeDate || data.activeDate === key) {
    return { ...data, activeDate: key };
  }
  const tasks = data.tasks || [];
  const pauses = data.pauses || [];
  const snapshot = {
    date: data.activeDate,
    done: tasks.filter((t) => t.done).length,
    byProj: byProject(tasks, null, 0),
    tasks: tasks.map((t) => ({ ...t, totalSec: t.totalSec || 0 })),
    pauses,
  };
  const carried = tasks
    .filter((t) => !t.done)
    .map((t) => ({ ...t, totalSec: 0 }));
  return {
    ...data,
    activeDate: key,
    history: [snapshot, ...(data.history || [])].slice(0, 90),
    tasks: carried,
    pauses: [],
    currentId: carried.length ? carried[0].id : null,
    elapsed: 0,
  };
}
