import { todayKey, nowHM, applyRollover } from "./logic.js";
import { defaultData } from "./seed.js";

export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  breakMinutes: 5,
  dailyMinutes: 240,
  theme: "dark",
  quietDuringFocus: true,
  desktopNotifications: false,
};
export const emptyTimer = () => ({
  phase: "focus",
  running: false,
  startedAt: null,
  elapsed: 0,
  duration: 1500,
  hasStarted: false,
});
const positive = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback;
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Upgrade older JSON files without discarding tasks, notes, or archived days. */
export function normalizeData(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks))
    throw new Error("invalid data");
  const data = { ...defaultData(), ...raw };
  data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
  for (const [key, max] of [
    ["focusMinutes", 120],
    ["breakMinutes", 60],
    ["dailyMinutes", 720],
  ]) {
    data.settings[key] = Math.min(
      max,
      positive(data.settings[key], DEFAULT_SETTINGS[key]),
    );
  }
  data.tasks = raw.tasks.map((t) => ({
    note: "",
    steps: [],
    totalSec: 0,
    estimateMin: 25,
    ...t,
  }));
  data.ideas = (raw.ideas || []).map((idea, i) => ({
    id: `legacy-${i}`,
    createdAt: null,
    reminder: "none",
    remindAt: null,
    readyAt: null,
    notifiedAt: null,
    done: false,
    ...idea,
  }));
  data.projects = [
    ...new Set([
      "未分類",
      ...(raw.projects || []),
      ...data.tasks.map((t) => t.project),
    ]),
  ].filter(Boolean);
  if (!data.tasks.some((t) => t.id === data.currentId && !t.done))
    data.currentId = data.tasks.find((t) => !t.done)?.id ?? null;
  data.timer = raw.timer
    ? { ...emptyTimer(), ...raw.timer }
    : { ...emptyTimer(), elapsed: Math.max(0, Number(raw.elapsed) || 0) };
  data.timer.hasStarted ||= data.timer.running || data.timer.elapsed > 0;
  data.timer.duration = positive(
    data.timer.duration,
    data.settings.focusMinutes * 60,
  );
  if (!data.currentId && data.timer.phase === "focus")
    data.timer = emptyTimer();
  data.activeDate ||= todayKey(new Date(now));
  data.elapsed = 0; // the timer now owns uncommitted elapsed time
  return advanceTime(data, now);
}

export function timerElapsed(data, now = Date.now()) {
  const timer = data.timer;
  const extra =
    timer.running && timer.startedAt != null
      ? Math.max(0, (now - timer.startedAt) / 1000)
      : 0;
  const elapsed = Math.max(0, timer.elapsed + extra);
  return data.mode === "pomodoro" || timer.phase === "break"
    ? Math.min(timer.duration, elapsed)
    : elapsed;
}

export function liveFocusSeconds(data, now = Date.now()) {
  return data.timer.phase === "focus" ? timerElapsed(data, now) : 0;
}

function releaseBreakReminders(data, now) {
  return {
    ...data,
    ideas: data.ideas.map((idea) =>
      !idea.done && idea.reminder === "break" && !idea.readyAt
        ? { ...idea, readyAt: now }
        : idea,
    ),
  };
}

function commitFocus(data, now) {
  if (data.timer.phase !== "focus") return data;
  const elapsed = timerElapsed(data, now);
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      t.id === data.currentId ? { ...t, totalSec: t.totalSec + elapsed } : t,
    ),
    timer: { ...data.timer, running: false, startedAt: null, elapsed: 0 },
  };
}

/** Run outside render: stop completed rounds exactly once; never count a break as work. */
function finishExpiredTimer(data, now) {
  const t = data.timer;
  if (
    !t.running ||
    (data.mode !== "pomodoro" && t.phase !== "break") ||
    timerElapsed(data, now) < t.duration
  )
    return data;
  const endedAt = t.startedAt + Math.max(0, t.duration - t.elapsed) * 1000;
  let next = t.phase === "focus" ? commitFocus(data, endedAt) : data;
  next = releaseBreakReminders(next, endedAt);
  return {
    ...next,
    timer: {
      ...emptyTimer(),
      phase: t.phase === "focus" ? "focusDone" : "breakDone",
    },
    lastTimerEvent: {
      id: `${t.phase}-${endedAt}`,
      phase: t.phase,
      at: endedAt,
    },
  };
}

/** Midnight splits running work across local days, including a throttled/asleep tab. */
export function advanceTime(data, now = Date.now()) {
  let next = data;
  const key = todayKey(new Date(now));
  let guard = 0;
  while (next.activeDate < key && guard++ < 3660) {
    const boundary = new Date(`${next.activeDate}T00:00:00`);
    boundary.setDate(boundary.getDate() + 1);
    const at = boundary.getTime();
    if (!Number.isFinite(at)) break;
    next = finishExpiredTimer(next, at);
    const timer = next.timer;
    const elapsed = timerElapsed(next, at);
    const id = next.currentId;
    if (timer.phase === "focus") next = commitFocus(next, at);
    next = applyRollover(next, todayKey(boundary));
    next.currentId = next.tasks.some((t) => t.id === id) ? id : next.currentId;
    // Only carry a timer when it still belongs to a carried task (or a break).
    if (timer.phase === "focus") {
      next.timer = {
        ...timer,
        elapsed: 0,
        startedAt: timer.running ? at : null,
        duration:
          next.mode === "pomodoro"
            ? Math.max(0, timer.duration - elapsed)
            : timer.duration,
      };
    } else next.timer = timer;
  }
  return finishExpiredTimer(next, now);
}

export function dueIdeas(data, now = Date.now()) {
  return data.ideas.filter(
    (i) =>
      !i.done &&
      ((i.reminder === "time" && i.remindAt != null && i.remindAt <= now) ||
        (i.reminder === "break" && i.readyAt != null && i.readyAt <= now)),
  );
}

export function createIdea(text, choice, custom, data, now = Date.now()) {
  const at =
    choice === "custom"
      ? new Date(custom).getTime()
      : now + Number(choice) * 60000;
  if (
    (choice === "custom" || !["break", "none"].includes(choice)) &&
    (!Number.isFinite(at) || at <= now)
  ) {
    throw new Error("請選擇未來的提醒時間。");
  }
  return {
    id: newId(),
    text: text.trim(),
    time: nowHM(new Date(now)),
    createdAt: now,
    done: false,
    reminder: ["break", "none"].includes(choice) ? choice : "time",
    remindAt: ["break", "none"].includes(choice) ? null : at,
    readyAt:
      choice === "break" &&
      (!data.timer.running || data.timer.phase !== "focus")
        ? now
        : null,
    notifiedAt: null,
  };
}

export function planSummary(data, now = Date.now()) {
  const live = liveFocusSeconds(data, now);
  const spent = data.tasks.reduce((n, t) => n + t.totalSec, live) / 60;
  const remaining = data.tasks
    .filter((t) => !t.done)
    .reduce(
      (n, t) =>
        n +
        Math.max(
          0,
          (t.estimateMin || 0) -
            (t.totalSec + (t.id === data.currentId ? live : 0)) / 60,
        ),
      0,
    );
  return {
    spent,
    remaining,
    budget: data.settings.dailyMinutes,
    over: Math.max(0, spent + remaining - data.settings.dailyMinutes),
  };
}

/** A single transition path prevents losing elapsed time on task or mode switches. */
export function transition(input, action, now = Date.now()) {
  let data = advanceTime(input, now);
  const current = () => data.tasks.find((t) => t.id === data.currentId);
  switch (action.type) {
    case "tick":
      return data;
    case "start": {
      if (!current() || current().done || data.timer.running) return data;
      const reset = data.timer.phase !== "focus";
      return {
        ...data,
        timer: {
          ...(reset ? emptyTimer() : data.timer),
          phase: "focus",
          running: true,
          startedAt: now,
          hasStarted: true,
          duration:
            reset || !data.timer.hasStarted
              ? data.settings.focusMinutes * 60
              : data.timer.duration,
        },
      };
    }
    case "pause": {
      if (!data.timer.running) return data;
      data = releaseBreakReminders(data, now);
      return {
        ...data,
        timer: {
          ...data.timer,
          elapsed: timerElapsed(data, now),
          running: false,
          startedAt: null,
        },
        pauses:
          data.timer.phase === "focus"
            ? [
                {
                  time: nowHM(new Date(now)),
                  reason: action.reason || "暫停",
                  task: current()?.title || "",
                },
                ...data.pauses,
              ]
            : data.pauses,
      };
    }
    case "reason":
      return {
        ...data,
        pauses: data.pauses.map((p, i) =>
          i === 0 ? { ...p, reason: action.reason } : p,
        ),
      };
    case "select": {
      if (
        action.id === data.currentId ||
        !data.tasks.some((t) => t.id === action.id && !t.done)
      )
        return data;
      data = releaseBreakReminders(commitFocus(data, now), now);
      return { ...data, currentId: action.id, timer: emptyTimer() };
    }
    case "mode": {
      if (action.mode === data.mode) return data;
      data = releaseBreakReminders(commitFocus(data, now), now);
      return { ...data, mode: action.mode, timer: emptyTimer() };
    }
    case "break": {
      data = releaseBreakReminders(commitFocus(data, now), now);
      return {
        ...data,
        timer: {
          phase: "break",
          running: true,
          startedAt: now,
          elapsed: 0,
          duration: data.settings.breakMinutes * 60,
        },
      };
    }
    case "resumeBreak":
      return data.timer.phase === "break" && !data.timer.running
        ? { ...data, timer: { ...data.timer, running: true, startedAt: now } }
        : data;
    case "endBreak":
      return { ...data, timer: emptyTimer() };
    case "complete": {
      const wasCurrent = action.id === data.currentId;
      if (wasCurrent) data = releaseBreakReminders(commitFocus(data, now), now);
      const tasks = data.tasks.map((t) =>
        t.id === action.id
          ? {
              ...t,
              done: true,
              summary: action.summary ?? t.summary,
              adjust: action.adjust ?? t.adjust,
            }
          : t,
      );
      return {
        ...data,
        tasks,
        ...(wasCurrent
          ? {
              timer: emptyTimer(),
              currentId: tasks.find((t) => !t.done)?.id ?? null,
            }
          : {}),
      };
    }
    case "reopen":
      return {
        ...data,
        tasks: data.tasks.map((t) =>
          t.id === action.id ? { ...t, done: false } : t,
        ),
        currentId: data.currentId ?? action.id,
      };
    case "addTask": {
      if (!action.title.trim()) return data;
      const task = {
        id: newId(),
        title: action.title.trim(),
        project: action.project || "未分類",
        estimateMin: Math.min(480, positive(action.estimateMin, 25)),
        done: false,
        totalSec: 0,
        note: "",
        steps: [],
      };
      return {
        ...data,
        tasks: [...data.tasks, task],
        currentId: data.currentId ?? task.id,
      };
    }
    case "updateTask":
      return {
        ...data,
        tasks: data.tasks.map((t) =>
          t.id === action.id ? { ...t, ...action.patch } : t,
        ),
      };
    case "moveTask": {
      const tasks = [...data.tasks];
      const from = tasks.findIndex((t) => t.id === action.id);
      const to = from + action.direction;
      if (from < 0 || to < 0 || to >= tasks.length) return data;
      [tasks[from], tasks[to]] = [tasks[to], tasks[from]];
      return { ...data, tasks };
    }
    case "capture":
      return { ...data, ideas: [action.idea, ...data.ideas] };
    case "ideaDone":
      return {
        ...data,
        ideas: data.ideas.map((i) =>
          i.id === action.id ? { ...i, done: !i.done } : i,
        ),
      };
    case "ideaRemove":
      return { ...data, ideas: data.ideas.filter((i) => i.id !== action.id) };
    case "ideaDismiss":
      return {
        ...data,
        ideas: data.ideas.map((i) =>
          i.id === action.id
            ? {
                ...i,
                reminder: "none",
                readyAt: null,
                remindAt: null,
                notifiedAt: null,
              }
            : i,
        ),
      };
    case "ideaSnooze":
      return {
        ...data,
        ideas: data.ideas.map((i) =>
          i.id === action.id
            ? {
                ...i,
                reminder: "time",
                remindAt: now + 10 * 60000,
                readyAt: null,
                notifiedAt: null,
              }
            : i,
        ),
      };
    case "ideaSchedule":
      return {
        ...data,
        ideas: data.ideas.map((i) =>
          i.id === action.id
            ? {
                ...i,
                reminder: action.reminder,
                remindAt: action.remindAt,
                readyAt: action.readyAt,
                notifiedAt: null,
              }
            : i,
        ),
      };
    case "notified":
      return {
        ...data,
        ideas: data.ideas.map((i) =>
          action.ids.includes(i.id) ? { ...i, notifiedAt: now } : i,
        ),
      };
    case "promote": {
      const idea = data.ideas.find((i) => i.id === action.id);
      if (!idea || idea.done) return data;
      data = transition(
        data,
        { type: "addTask", title: idea.text, project: "來自 Idea" },
        now,
      );
      return {
        ...data,
        projects: [...new Set([...data.projects, "來自 Idea"])],
        ideas: data.ideas.map((i) =>
          i.id === idea.id ? { ...i, done: true } : i,
        ),
      };
    }
    case "renameProject": {
      const name = action.name.trim();
      if (action.oldName === "未分類" || !name || data.projects.includes(name))
        return data;
      return {
        ...data,
        projects: data.projects.map((p) => (p === action.oldName ? name : p)),
        tasks: data.tasks.map((t) =>
          t.project === action.oldName ? { ...t, project: name } : t,
        ),
        newTaskProj:
          data.newTaskProj === action.oldName ? name : data.newTaskProj,
      };
    }
    case "removeProject": {
      if (action.name === "未分類") return data;
      return {
        ...data,
        projects: data.projects.filter((p) => p !== action.name),
        tasks: data.tasks.map((t) =>
          t.project === action.name ? { ...t, project: "未分類" } : t,
        ),
        newTaskProj:
          data.newTaskProj === action.name ? "未分類" : data.newTaskProj,
      };
    }
    case "settings":
      return { ...data, settings: { ...data.settings, ...action.patch } };
    case "patch":
      return { ...data, ...action.patch };
    default:
      return data;
  }
}
