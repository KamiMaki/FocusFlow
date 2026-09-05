import { describe, it, expect } from "vitest";
import {
  normalizeData,
  transition,
  timerElapsed,
  liveFocusSeconds,
  dueIdeas,
  createIdea,
  planSummary,
} from "./model.js";
import { defaultData } from "./seed.js";
const baseTime = new Date(2026, 8, 5, 10).getTime();
const setup = (mode = "pomodoro", now = baseTime) => {
  let d = normalizeData({ ...defaultData(), mode }, now);
  d = transition(
    d,
    { type: "addTask", title: "第一件事", estimateMin: 50 },
    now,
  );
  d = transition(
    d,
    { type: "addTask", title: "第二件事", estimateMin: 25 },
    now,
  );
  return d;
};
const start = (d, now = baseTime) => transition(d, { type: "start" }, now);

describe("focus time accounting", () => {
  it("credits work when switching tasks; switching back does not lose or double count it", () => {
    let d = start(setup());
    const first = d.currentId;
    d = transition(d, { type: "select", id: d.tasks[1].id }, baseTime + 90000);
    expect(d.tasks[0].totalSec).toBe(90);
    expect(d.timer.running).toBe(false);
    d = start(d, baseTime + 100000);
    d = transition(d, { type: "select", id: first }, baseTime + 160000);
    expect(d.tasks.map((t) => t.totalSec)).toEqual([90, 60]);
    expect(liveFocusSeconds(d, baseTime + 200000)).toBe(0);
  });
  it("caps a throttled pomodoro at its planned end and records it exactly once", () => {
    let d = start(setup());
    d = transition(d, { type: "tick" }, baseTime + 3600000);
    expect(d.timer.phase).toBe("focusDone");
    expect(d.timer.running).toBe(false);
    expect(d.tasks[0].totalSec).toBe(1500);
    expect(transition(d, { type: "tick" }, baseTime + 4000000)).toBe(d);
    d = start(d, baseTime + 4100000);
    d = transition(d, { type: "pause" }, baseTime + 4160000);
    expect(d.tasks[0].totalSec + liveFocusSeconds(d, baseTime + 4160000)).toBe(
      1560,
    );
  });
  it("excludes pauses and breaks from work, including completing a task during a break", () => {
    let d = start(setup());
    d = transition(d, { type: "pause" }, baseTime + 60000);
    d = start(d, baseTime + 600000);
    expect(timerElapsed(d, baseTime + 660000)).toBe(120);
    d = transition(d, { type: "break" }, baseTime + 660000);
    expect(d.tasks[0].totalSec).toBe(120);
    expect(liveFocusSeconds(d, baseTime + 720000)).toBe(0);
    d = transition(d, { type: "complete", id: d.currentId }, baseTime + 750000);
    expect(d.tasks[0].totalSec).toBe(120);
  });
  it("credits elapsed work before changing timer modes", () => {
    let d = start(setup("stopwatch"));
    d = transition(d, { type: "mode", mode: "pomodoro" }, baseTime + 300000);
    expect(d.tasks[0].totalSec).toBe(300);
    expect(d.timer.running).toBe(false);
    expect(timerElapsed(d, baseTime + 600000)).toBe(0);
  });
  it("recovers a running timer on reload using its original timestamp", () => {
    const d = start(setup());
    const restored = normalizeData(
      JSON.parse(JSON.stringify(d)),
      baseTime + 600000,
    );
    expect(timerElapsed(restored, baseTime + 600000)).toBe(600);
    expect(restored.timer.running).toBe(true);
  });
  it("never starts on an empty or completed task list", () => {
    let d = normalizeData(defaultData(), baseTime);
    expect(start(d).timer.running).toBe(false);
    d = transition(d, { type: "addTask", title: "唯一任務" }, baseTime);
    d = transition(d, { type: "complete", id: d.currentId }, baseTime);
    expect(start(d).timer.running).toBe(false);
  });
  it("stops breaks after their duration and does not auto-start work", () => {
    let d = transition(setup(), { type: "break" }, baseTime);
    d = transition(d, { type: "tick" }, baseTime + 600000);
    expect(d.timer.phase).toBe("breakDone");
    expect(d.timer.running).toBe(false);
    expect(d.tasks[0].totalSec).toBe(0);
  });
  it("splits a live stopwatch across local midnight and retains task notes", () => {
    const before = new Date(2026, 8, 5, 23, 59).getTime();
    const after = new Date(2026, 8, 6, 0, 1).getTime();
    let d = setup("stopwatch", before);
    d = transition(
      d,
      {
        type: "updateTask",
        id: d.currentId,
        patch: { note: "不要遺失", steps: [{ text: "下一步" }] },
      },
      before,
    );
    d = start(d, before);
    d = transition(d, { type: "tick" }, after);
    expect(d.history[0].tasks[0].totalSec).toBe(60);
    expect(d.history[0].tasks[0].note).toBe("不要遺失");
    expect(d.tasks[0].totalSec).toBe(0);
    expect(timerElapsed(d, after)).toBe(60);
    d = transition(d, { type: "select", id: d.tasks[1].id }, after);
    expect(d.tasks[0].totalSec).toBe(60);
  });
  it("splits a pomodoro at midnight without extending the original end", () => {
    const before = new Date(2026, 8, 5, 23, 50).getTime();
    const after = new Date(2026, 8, 6, 0, 30).getTime();
    let d = start(setup("pomodoro", before), before);
    d = transition(d, { type: "tick" }, after);
    expect(d.history[0].tasks[0].totalSec).toBe(600);
    expect(d.tasks[0].totalSec).toBe(900);
    expect(d.timer.phase).toBe("focusDone");
  });
  it("does not attribute an already finished pomodoro to a later day after sleep", () => {
    let d = start(setup());
    d = transition(d, { type: "tick" }, new Date(2026, 8, 7, 10).getTime());
    expect(
      d.history.find((h) => h.date === "2026-09-05").tasks[0].totalSec,
    ).toBe(1500);
    expect(d.tasks[0].totalSec).toBe(0);
  });
  it("keeps the remaining round when a paused pomodoro resumes after midnight", () => {
    const before = new Date(2026, 8, 5, 23, 50).getTime();
    const after = new Date(2026, 8, 6, 0, 5).getTime();
    let d = start(setup("pomodoro", before), before);
    d = transition(d, { type: "pause" }, before + 300000);
    d = transition(d, { type: "tick" }, after);
    d = start(d, after);
    d = transition(d, { type: "tick" }, after + 1200000);
    expect(d.history[0].tasks[0].totalSec).toBe(300);
    expect(d.tasks[0].totalSec).toBe(1200);
    expect(d.timer.phase).toBe("focusDone");
  });
});

describe("distraction reminders and planning", () => {
  it("keeps break reminders waiting, then releases them on pause without stopping capture time", () => {
    let d = start(setup());
    const idea = createIdea("晚點查資料", "break", "", d, baseTime + 30000);
    d = transition(d, { type: "capture", idea }, baseTime + 30000);
    expect(d.timer.running).toBe(true);
    expect(dueIdeas(d, baseTime + 60000)).toHaveLength(0);
    d = transition(d, { type: "pause" }, baseTime + 120000);
    expect(dueIdeas(d, baseTime + 120000)).toHaveLength(1);
    expect(liveFocusSeconds(d, baseTime + 120000)).toBe(120);
  });
  it("releases break reminders when a pomodoro expires", () => {
    let d = start(setup());
    d = transition(
      d,
      { type: "capture", idea: createIdea("回訊息", "break", "", d, baseTime) },
      baseTime,
    );
    d = transition(d, { type: "tick" }, baseTime + 1500000);
    expect(dueIdeas(d, baseTime + 1500000)).toHaveLength(1);
  });
  it("shows new break reminders immediately when already resting", () => {
    const d = transition(setup(), { type: "break" }, baseTime);
    expect(createIdea("泡茶", "break", "", d, baseTime).readyAt).toBe(baseTime);
  });
  it("keeps overdue timed reminders after reload, snoozes once, and cancels them", () => {
    let d = setup();
    const idea = createIdea("回信", "10", "", d, baseTime);
    d = transition(d, { type: "capture", idea }, baseTime);
    d = normalizeData(d, baseTime + 660000);
    expect(dueIdeas(d, baseTime + 660000)).toHaveLength(1);
    d = transition(d, { type: "ideaSnooze", id: idea.id }, baseTime + 660000);
    expect(dueIdeas(d, baseTime + 660000)).toHaveLength(0);
    expect(dueIdeas(d, baseTime + 1260000)).toHaveLength(1);
    d = transition(d, { type: "ideaDismiss", id: idea.id }, baseTime + 1260000);
    expect(dueIdeas(d, baseTime + 2000000)).toHaveLength(0);
  });
  it("rejects invalid or past custom reminders", () => {
    for (const value of ["", "not-a-date", "2020-01-01T10:00"])
      expect(() => createIdea("x", "custom", value, setup(), baseTime)).toThrow(
        "未來",
      );
  });
  it("promotes a distraction into a task once and stops its reminders", () => {
    let d = setup();
    const idea = createIdea("買東西", "break", "", d, baseTime);
    d = transition(d, { type: "capture", idea }, baseTime);
    d = transition(d, { type: "promote", id: idea.id }, baseTime);
    d = transition(d, { type: "promote", id: idea.id }, baseTime);
    expect(d.tasks.filter((t) => t.title === "買東西")).toHaveLength(1);
    expect(d.projects).toContain("來自 Idea");
    expect(dueIdeas(d, baseTime)).toHaveLength(0);
  });
  it("migrates legacy ideas without inventing reminders or losing old elapsed time", () => {
    const d = normalizeData(
      {
        ...setup(),
        timer: undefined,
        elapsed: 180,
        ideas: [{ text: "舊想法", time: "09:00" }],
      },
      baseTime,
    );
    expect(d.ideas[0].text).toBe("舊想法");
    expect(d.ideas[0].id).toBeTruthy();
    expect(dueIdeas(d, baseTime)).toHaveLength(0);
    expect(liveFocusSeconds(d, baseTime)).toBe(180);
  });
  it("calculates remaining effort and shows time that exceeds the daily budget", () => {
    let d = setup();
    d.settings.dailyMinutes = 60;
    d = start(d);
    const summary = planSummary(d, baseTime + 600000);
    expect(summary).toEqual({ spent: 10, remaining: 65, budget: 60, over: 15 });
  });
});
