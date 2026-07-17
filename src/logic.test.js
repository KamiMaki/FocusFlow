import { describe, it, expect } from 'vitest';
import {
  todayKey,
  fmtTime,
  nowHM,
  parseStyle,
  projSeconds,
  byProject,
  computeToday,
  computeAnalytics,
  buildExport,
  buildIdeaPrompt,
  applyRollover,
} from './logic.js';

describe('todayKey', () => {
  it('returns a local YYYY-MM-DD string, zero-padded', () => {
    expect(todayKey(new Date(2026, 6, 18, 23, 59))).toBe('2026-07-18');
    expect(todayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
  it('uses local (not UTC) components at day boundary', () => {
    // Local midnight — UTC-based .toISOString() could roll to the previous day
    // in positive timezones; todayKey must stay on the local date.
    const d = new Date(2026, 2, 1, 0, 30); // 2026-03-01 00:30 local
    expect(todayKey(d)).toBe('2026-03-01');
  });
});

describe('fmtTime', () => {
  it('formats mm:ss under an hour', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(65)).toBe('01:05');
    expect(fmtTime(599)).toBe('09:59');
  });
  it('formats h:mm:ss at or above an hour', () => {
    expect(fmtTime(3600)).toBe('1:00:00');
    expect(fmtTime(3720)).toBe('1:02:00');
  });
});

describe('nowHM', () => {
  it('formats HH:MM zero-padded', () => {
    expect(nowHM(new Date(2026, 6, 18, 9, 4))).toBe('09:04');
    expect(nowHM(new Date(2026, 6, 18, 18, 30))).toBe('18:30');
  });
});

describe('parseStyle', () => {
  it('parses a css string into a camelCased object', () => {
    expect(parseStyle('background:#111927;border:1px solid #1d2839')).toEqual({
      background: '#111927',
      border: '1px solid #1d2839',
    });
  });
  it('camelCases kebab properties and tolerates trailing semicolons', () => {
    expect(parseStyle('border-bottom:1px solid #1a2333;')).toEqual({
      borderBottom: '1px solid #1a2333',
    });
  });
  it('returns empty object for empty input', () => {
    expect(parseStyle('')).toEqual({});
  });
});

describe('projSeconds / byProject', () => {
  const tasks = [
    { id: 1, title: 'A', project: 'P1', totalSec: 100 },
    { id: 2, title: 'B', project: 'P2', totalSec: 0 },
    { id: 3, title: 'C', project: 'P1', totalSec: 50 },
  ];
  it('adds live elapsed only to the current task', () => {
    expect(projSeconds(tasks[0], 1, 30)).toBe(130);
    expect(projSeconds(tasks[1], 1, 30)).toBe(0);
  });
  it('aggregates by project excluding zero totals', () => {
    expect(byProject(tasks, 1, 0)).toEqual({ P1: 150 });
    expect(byProject(tasks, 2, 20)).toEqual({ P1: 150, P2: 20 });
  });
});

describe('computeToday + computeAnalytics', () => {
  const tasks = [
    { id: 1, title: 'A', project: 'P1', done: true, totalSec: 3600, steps: [] },
    { id: 2, title: 'B', project: 'P2', done: false, totalSec: 1800, steps: [] },
  ];
  const pauses = [{ time: '10:00', reason: '會議', task: 'A' }];
  const history = [
    { date: '2026-07-17', done: 1, byProj: { P1: 3600 }, tasks: [], pauses: [{ time: '09:00', reason: '會議', task: 'x' }] },
  ];
  it('builds today snapshot with done count and byProj', () => {
    const t = computeToday(tasks, pauses, 1, 0);
    expect(t.date).toBe('今天');
    expect(t.done).toBe(1);
    expect(t.byProj).toEqual({ P1: 3600, P2: 1800 });
    expect(t.pauses).toBe(pauses);
  });
  it('computes trend, reason stats and insight across days', () => {
    const days = [computeToday(tasks, pauses, 1, 0), ...history];
    const a = computeAnalytics(days);
    expect(a.trend.length).toBeGreaterThan(0);
    // 會議 appears twice across the 2 days
    const meeting = a.reasonStats.find((r) => r.reason === '會議');
    expect(meeting.count).toBe(2);
    expect(a.insight).toContain('會議');
    expect(a.projStats.find((p) => p.name === 'P1').sec).toBe(7200);
  });
  it('handles empty history/pauses without throwing', () => {
    const days = [computeToday([], [], null, 0)];
    const a = computeAnalytics(days);
    expect(a.reasonStats).toEqual([]);
    expect(a.insight).toContain('沒有中斷');
    expect(a.avgSec).toBe(0);
  });
});

describe('buildExport', () => {
  const base = {
    tasks: [{ id: 1, title: 'A', project: 'P1', done: true, totalSec: 3600, steps: [], note: '', summary: '寫完初稿', adjust: '' }],
    pauses: [],
    ideas: [],
    globalNote: '',
    currentId: 1,
    elapsed: 0,
    now: new Date(2026, 6, 18),
  };
  it('produces a report with task line and no-interrupt marker', () => {
    const txt = buildExport(base);
    expect(txt).toContain('[完成] A');
    expect(txt).toContain('做了什麼：寫完初稿');
    expect(txt).toContain('## 中斷紀錄（0 次）');
    expect(txt).toContain('- 無');
  });
  it('lists pauses and total project time when present', () => {
    const txt = buildExport({ ...base, pauses: [{ time: '10:00', reason: '會議', task: 'A' }] });
    expect(txt).toContain('10:00 會議（A）');
    expect(txt).toContain('## 各專案工時');
  });
});

describe('buildIdeaPrompt', () => {
  it('embeds the idea text and asks for staged tasks', () => {
    const p = buildIdeaPrompt('做一個新功能');
    expect(p).toContain('我的 idea：做一個新功能');
    expect(p).toContain('階段一');
  });
});

describe('applyRollover', () => {
  const mkData = (activeDate) => ({
    activeDate,
    tasks: [
      { id: 1, title: 'done one', project: 'P1', done: true, totalSec: 3600, steps: [], note: 'n' },
      { id: 2, title: 'open one', project: 'P2', done: false, totalSec: 1200, steps: [{ text: 's', time: '10:00' }], note: '' },
    ],
    pauses: [{ time: '10:00', reason: '會議', task: 'done one' }],
    currentId: 1,
    history: [],
  });
  it('is a no-op on the same local day', () => {
    const d = mkData('2026-07-18');
    const out = applyRollover(d, '2026-07-18');
    expect(out.history).toHaveLength(0);
    expect(out.tasks).toHaveLength(2);
  });
  it('archives the previous day and resets transient state on a new day', () => {
    const out = applyRollover(mkData('2026-07-17'), '2026-07-18');
    expect(out.activeDate).toBe('2026-07-18');
    expect(out.history).toHaveLength(1);
    expect(out.history[0].date).toBe('2026-07-17');
    expect(out.history[0].done).toBe(1);
    expect(out.history[0].byProj).toEqual({ P1: 3600, P2: 1200 });
    expect(out.pauses).toEqual([]);
    // completed tasks archived out of the active list, open ones carried with reset time
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].id).toBe(2);
    expect(out.tasks[0].totalSec).toBe(0);
    expect(out.tasks[0].steps).toEqual([{ text: 's', time: '10:00' }]);
    expect(out.currentId).toBe(2);
  });
  it('handles empty/undefined data without throwing', () => {
    const out = applyRollover({ activeDate: null, tasks: [], pauses: [], history: [] }, '2026-07-18');
    expect(out.activeDate).toBe('2026-07-18');
    expect(out.tasks).toEqual([]);
  });
});
