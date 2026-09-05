import React, { useEffect, useRef, useState } from "react";
import { loadData, createSaver } from "./api.js";
import {
  fmtTime,
  nowHM,
  computeToday,
  computeAnalytics,
  buildExport,
  buildIdeaPrompt,
} from "./logic.js";
import {
  normalizeData,
  transition,
  timerElapsed,
  liveFocusSeconds,
  createIdea,
  dueIdeas,
  planSummary,
} from "./model.js";
import "./styles.css";

const minutes = (sec) => `${Math.round(sec / 60)} 分`;
const isComposing = (e) =>
  e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229;
const reminderLabel = (idea) =>
  idea.reminder === "time" && idea.remindAt
    ? new Date(idea.remindAt).toLocaleString("zh-TW", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : idea.reminder === "break"
      ? "下次暫停或休息時"
      : "暫不提醒";

function Icon({ name, size = 20 }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    play: <path d="m9 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    focus: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    note: (
      <>
        <path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    cup: (
      <>
        <path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5L9 20H4v-5ZM13 6l5 5" />
      </>
    ),
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.note}
    </svg>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    const cancel = (e) => {
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="關閉視窗" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function TaskForm({
  projects,
  task,
  initialProject = "未分類",
  onSave,
  onClose,
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [project, setProject] = useState(task?.project || initialProject);
  const [estimate, setEstimate] = useState(task?.estimateMin || 25);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim())
          onSave({
            title: title.trim(),
            project,
            estimateMin: Number(estimate),
          });
      }}
    >
      <label>
        想完成什麼？
        <input
          autoFocus
          required
          maxLength={240}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：完成報告的第一段"
          onKeyDown={(e) => {
            if (e.key === "Enter" && isComposing(e)) e.preventDefault();
          }}
        />
      </label>
      <div className="form-grid">
        <label>
          專案
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          預留時間（分鐘）
          <input
            type="number"
            min="1"
            max="480"
            required
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
          />
        </label>
      </div>
      <p className="help">抓個大概就好，之後隨時可以調整。</p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" disabled={!title.trim()}>
          {task ? "儲存修改" : "加入今天"}
        </button>
      </div>
    </form>
  );
}

function CaptureForm({ data, idea, draft, setDraft, onSave }) {
  const [text, setText] = useState(idea?.text || draft);
  const [choice, setChoice] = useState(
    idea?.reminder === "time"
      ? "custom"
      : idea?.reminder || (data.timer.running ? "break" : "10"),
  );
  const toLocalInput = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${nowHM(d)}`;
  };
  const [custom, setCustom] = useState(
    idea?.remindAt ? toLocalInput(idea.remindAt) : "",
  );
  const [error, setError] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    try {
      onSave(createIdea(text, choice, custom, data));
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!idea && <p className="dialog-intro">先放在這裡，回到手上的那件事。</p>}
      <label>
        {idea ? "記下的事" : "腦中想到什麼？"}
        <textarea
          autoFocus
          required
          maxLength={2000}
          rows={3}
          value={text}
          readOnly={!!idea}
          placeholder="要回的訊息、突然想到的事、晚點再查的問題…"
          onChange={(e) => {
            setText(e.target.value);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isComposing(e)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <label>
        什麼時候提醒？
        <select
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value);
            setError("");
          }}
        >
          <option value="break">下次暫停或休息時</option>
          <option value="10">10 分鐘後</option>
          <option value="30">30 分鐘後</option>
          <option value="60">1 小時後</option>
          <option value="custom">指定時間</option>
          <option value="none">只記下，暫不提醒</option>
        </select>
      </label>
      {choice === "custom" && (
        <label>
          提醒日期與時間
          <input
            type="datetime-local"
            required
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="help">
        {data.settings.quietDuringFocus
          ? "專注中到期的提醒，會留到暫停或休息時出現。"
          : "到時間會在頁面內輕聲提醒，不播放音效。"}{" "}
        頁面關閉時無法發出通知，重開後會補列。
      </p>
      <div className="dialog-actions">
        <span className="help">Enter 儲存 · Shift + Enter 換行</span>
        <button className="primary" disabled={!text.trim()}>
          {idea ? "更新提醒" : "記下，回到專注"}
        </button>
      </div>
    </form>
  );
}

function FinishForm({ task, elapsed, onSave }) {
  const [summary, setSummary] = useState("");
  const [adjust, setAdjust] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(summary, adjust);
      }}
    >
      <p className="dialog-intro">
        {task.title} · {minutes(task.totalSec + elapsed)}
      </p>
      <label>
        完成了什麼？ <span className="muted">選填</span>
        <textarea
          autoFocus
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="記下一點進展，或直接完成。"
        />
      </label>
      <label>
        下次可以調整的地方 <span className="muted">選填</span>
        <textarea
          rows={2}
          value={adjust}
          onChange={(e) => setAdjust(e.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <button className="primary">完成任務</button>
      </div>
    </form>
  );
}

function ProjectManager({ data, send }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <p className="help">移除專案時，任務會保留在「未分類」。</p>
      <div className="project-list">
        {data.projects.map((project) => (
          <ProjectRow
            key={project}
            project={project}
            projects={data.projects}
            send={send}
          />
        ))}
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value) return;
          if (data.projects.includes(value)) {
            setError("已經有這個專案了。");
            return;
          }
          send({
            type: "patch",
            patch: { projects: [...data.projects, value], newTaskProj: value },
          });
          setName("");
          setError("");
        }}
      >
        <label className="grow">
          新增專案
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </label>
        <button className="secondary" disabled={!name.trim()}>
          新增
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </>
  );
}
function ProjectRow({ project, projects, send }) {
  const [name, setName] = useState(project);
  const invalid =
    !name.trim() || (name.trim() !== project && projects.includes(name.trim()));
  return (
    <div className="project-row">
      <input
        aria-label={`專案名稱：${project}`}
        value={name}
        disabled={project === "未分類"}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
      />
      {project !== "未分類" && (
        <>
          <button
            className="text-button"
            disabled={invalid || name === project}
            onClick={() =>
              send({ type: "renameProject", oldName: project, name })
            }
          >
            儲存
          </button>
          <button
            className="text-button"
            onClick={() => send({ type: "removeProject", name: project })}
          >
            移除
          </button>
        </>
      )}
    </div>
  );
}

function Settings({ data, send, notice }) {
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const enable = async () => {
    try {
      const value = await Notification.requestPermission();
      setPermission(value);
      send({
        type: "settings",
        patch: { desktopNotifications: value === "granted" },
      });
    } catch {
      notice("這個瀏覽器無法開啟桌面通知，頁面內提醒仍可使用。");
    }
  };
  const update = (patch) => send({ type: "settings", patch });
  return (
    <div className="settings-content">
      <div className="form-grid">
        <label>
          每段專注
          <select
            value={data.settings.focusMinutes}
            onChange={(e) => update({ focusMinutes: Number(e.target.value) })}
          >
            {[15, 25, 40, 50, 60].map((n) => (
              <option key={n} value={n}>
                {n} 分鐘
              </option>
            ))}
          </select>
        </label>
        <label>
          休息時間
          <select
            value={data.settings.breakMinutes}
            onChange={(e) => update({ breakMinutes: Number(e.target.value) })}
          >
            {[3, 5, 10, 15].map((n) => (
              <option key={n} value={n}>
                {n} 分鐘
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="help">時間設定從下一段開始套用。</p>
      <label>
        今天可用的專注時間
        <select
          value={data.settings.dailyMinutes}
          onChange={(e) => update({ dailyMinutes: Number(e.target.value) })}
        >
          {[60, 120, 180, 240, 300, 360, 420, 480].map((n) => (
            <option key={n} value={n}>
              {n / 60} 小時
            </option>
          ))}
        </select>
      </label>
      <label>
        外觀
        <select
          value={data.settings.theme}
          onChange={(e) => update({ theme: e.target.value })}
        >
          <option value="dark">夜色</option>
          <option value="light">日光</option>
        </select>
      </label>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={data.settings.quietDuringFocus}
          onChange={(e) => update({ quietDuringFocus: e.target.checked })}
        />
        <span>專注時先收好提醒，休息時再看</span>
      </label>
      <div className="setting-divider">
        <h3>桌面通知</h3>
        <p className="help">
          不播放音效。需保持 FocusFlow
          頁面與本機服務開啟；電腦休眠或瀏覽器節流可能讓通知延後。
        </p>
        {permission === "unsupported" ? (
          <p className="help">這個瀏覽器未提供桌面通知；頁面內提醒仍可使用。</p>
        ) : permission === "denied" ? (
          <p className="help">通知已被封鎖，可以在瀏覽器的網站設定中開啟。</p>
        ) : data.settings.desktopNotifications && permission === "granted" ? (
          <button
            className="secondary"
            onClick={() => update({ desktopNotifications: false })}
          >
            關閉桌面通知
          </button>
        ) : (
          <button className="secondary" onClick={enable}>
            開啟桌面通知
          </button>
        )}
      </div>
      <p className="help">
        快速記下：Ctrl / ⌘ + Shift + K（在 FocusFlow 頁面內）
      </p>
    </div>
  );
}

function History({ data, now }) {
  const [selected, setSelected] = useState(0);
  const days = [
    computeToday(
      data.tasks,
      data.pauses,
      data.currentId,
      liveFocusSeconds(data, now),
    ),
    ...data.history,
  ];
  const day = days[Math.min(selected, days.length - 1)];
  const analytics = computeAnalytics(days);
  const total = (d) => Object.values(d.byProj || {}).reduce((a, b) => a + b, 0);
  return (
    <main className="history-layout" id="main-content" tabIndex={-1}>
      <section className="panel history-days">
        <div className="panel-heading">
          <h2>每日紀錄</h2>
        </div>
        {days.map((d, i) => (
          <button
            key={d.date}
            className={`day-button ${i === selected ? "selected" : ""}`}
            onClick={() => setSelected(i)}
            aria-pressed={i === selected}
          >
            <span>{d.date}</span>
            <span className="muted">
              {minutes(total(d))} · 完成 {d.done} 件
            </span>
          </button>
        ))}
      </section>
      <section className="panel day-detail">
        <div className="panel-heading">
          <h2>{day.date}</h2>
          <span className="muted">專注 {minutes(total(day))}</span>
        </div>
        {!day.tasks.length && (
          <p className="empty-copy">還沒有紀錄，從一小段專注開始。</p>
        )}
        {day.tasks.map((t, i) => (
          <div className="history-task" key={i}>
            <Icon name={t.done ? "check" : "note"} />
            <div className="grow">
              <strong>{t.title}</strong>
              <span className="muted">
                {t.project} · {t.done ? "已完成" : "進行中"}
              </span>
              {t.summary && <p>{t.summary}</p>}
              {t.note && <p className="preserve-lines">{t.note}</p>}
            </div>
            <span className="muted">{minutes(t.totalSec)}</span>
          </div>
        ))}
        <details className="disclosure">
          <summary>中斷紀錄 · {(day.pauses || []).length}</summary>
          <div className="detail-body">
            {(day.pauses || []).map((p, i) => (
              <p className="log-line" key={i}>
                <time>{p.time}</time>
                <span>
                  {p.reason} · {p.task}
                </span>
              </p>
            ))}
            {!day.pauses?.length && <p className="help">這天沒有中斷紀錄。</p>}
          </div>
        </details>
      </section>
      <section className="panel analytics">
        <div className="panel-heading">
          <h2>最近 7 天</h2>
        </div>
        <p className="metric">
          {minutes(analytics.avgSec)}
          <span>每日平均專注</span>
        </p>
        <div
          className="trend"
          role="img"
          aria-label={analytics.trend
            .map(({ day: d, total: t }) => `${d.date}：${minutes(t)}`)
            .join("；")}
        >
          {analytics.trend.map(({ day: d, total: t }) => (
            <div className="trend-day" key={d.date}>
              <span>{Math.round(t / 60)}</span>
              <div className="trend-track">
                <div style={{ height: `${(t / analytics.maxDay) * 100}%` }} />
              </div>
              <span>{d.date === "今天" ? "今天" : d.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <h3>專案投入</h3>
        {analytics.projStats.map((p) => (
          <div className="bar-item" key={p.name}>
            <div>
              <span>{p.name}</span>
              <span>{minutes(p.sec)}</span>
            </div>
            <progress max="1" value={p.ratio} />
          </div>
        ))}
        <h3>中斷原因</h3>
        {analytics.reasonStats.map((r) => (
          <div className="bar-item" key={r.reason}>
            <div>
              <span>{r.reason}</span>
              <span>{r.count} 次</span>
            </div>
            <progress max="1" value={r.ratio} />
          </div>
        ))}
        <p className="help">{analytics.insight}</p>
      </section>
    </main>
  );
}

function NoteArea({ data, current, send }) {
  const [tab, setTab] = useState("task");
  const [reply, setReply] = useState("");
  return (
    <details className="panel notes-panel">
      <summary>
        筆記與待回覆{" "}
        <span className="muted">
          {data.replies.filter((r) => !r.done).length
            ? `${data.replies.filter((r) => !r.done).length} 則待回覆`
            : "需要時再展開"}
        </span>
      </summary>
      <div className="detail-body">
        <div className="segmented" aria-label="筆記種類">
          {[
            ["task", "任務筆記"],
            ["global", "隨手筆記"],
            ["replies", "待回覆"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "task" && (
          <label>
            {current?.title || "先選一件任務"}
            <textarea
              disabled={!current}
              rows={5}
              value={current?.note || ""}
              placeholder="連結、進度、參考資料…"
              onChange={(e) =>
                send({
                  type: "updateTask",
                  id: current.id,
                  patch: { note: e.target.value },
                })
              }
            />
          </label>
        )}
        {tab === "global" && (
          <label>
            隨手筆記
            <textarea
              rows={5}
              value={data.globalNote}
              onChange={(e) =>
                send({ type: "patch", patch: { globalNote: e.target.value } })
              }
            />
          </label>
        )}
        {tab === "replies" && (
          <>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (reply.trim()) {
                  send({
                    type: "patch",
                    patch: {
                      replies: [
                        ...data.replies,
                        { text: reply.trim(), done: false },
                      ],
                    },
                  });
                  setReply("");
                }
              }}
            >
              <input
                aria-label="新增待回覆"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="要回覆誰、什麼事？"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isComposing(e)) e.preventDefault();
                }}
              />
              <button className="secondary" disabled={!reply.trim()}>
                加入
              </button>
            </form>
            {data.replies.map((r, i) => (
              <label className="checkbox-line" key={i}>
                <input
                  type="checkbox"
                  checked={r.done}
                  onChange={() =>
                    send({
                      type: "patch",
                      patch: {
                        replies: data.replies.map((x, j) =>
                          j === i ? { ...x, done: !x.done } : x,
                        ),
                      },
                    })
                  }
                />
                <span className={r.done ? "completed-text" : ""}>{r.text}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </details>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  const [loadError, setLoadError] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState("today");
  const [focusMode, setFocusMode] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [captureDraft, setCaptureDraft] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [inboxFilter, setInboxFilter] = useState("open");
  const [step, setStep] = useState("");
  const [idleDismissed, setIdleDismissed] = useState(false);
  const idleSince = useRef(Date.now());
  const [breakDismissed, setBreakDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const saver = useRef(null);
  if (!saver.current) saver.current = createSaver(500, setSaveStatus);
  const send = (action) => {
    if (!dataRef.current) return;
    const next = transition(dataRef.current, action);
    if (next !== dataRef.current) {
      dataRef.current = next;
      setData(next);
      saver.current.schedule(next);
    }
    return next;
  };
  const load = async () => {
    setLoadError(false);
    try {
      const next = normalizeData(await loadData());
      dataRef.current = next;
      setData(next);
      saver.current.schedule(next);
    } catch {
      setLoadError(true);
    }
  };
  useEffect(() => {
    let active = true;
    loadData()
      .then((raw) => {
        if (active) {
          const next = normalizeData(raw);
          dataRef.current = next;
          setData(next);
          saver.current.schedule(next);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    const tick = () => {
      setNow(Date.now());
      send({ type: "tick" });
    };
    const timer = setInterval(tick, 1000);
    const visibility = () => {
      if (document.visibilityState === "hidden") saver.current.flush();
      else tick();
    };
    const flush = (e) => {
      saver.current.flush();
      if (saver.current.hasPending()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const shortcut = (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.code === "KeyK" &&
        !e.repeat &&
        !e.isComposing &&
        dataRef.current &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setModal({ type: "capture" });
      }
    };
    const retry = () => saver.current.retry();
    window.addEventListener("keydown", shortcut);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visibility);
      saver.current.flush();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.theme = data.settings.theme;
  }, [data?.settings.theme]);
  useEffect(() => {
    if (data && taskFilter !== "all" && !data.projects.includes(taskFilter))
      setTaskFilter("all");
  }, [data?.projects, taskFilter]);
  useEffect(() => {
    idleSince.current = Date.now();
    setIdleDismissed(false);
    setBreakDismissed(false);
  }, [data?.timer.running, data?.currentId, data?.timer.phase]);
  const notify = (title, body) => {
    if (
      !dataRef.current?.settings.desktopNotifications ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return false;
    try {
      const notification = new Notification(title, {
        body,
        tag: "focusflow",
        silent: true,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    const event = data?.lastTimerEvent;
    if (!event || event.notified) return;
    notify(
      "FocusFlow",
      event.phase === "focus"
        ? "這段專注結束了，休息一下。"
        : "休息結束，準備好再開始。",
    );
    send({
      type: "patch",
      patch: { lastTimerEvent: { ...event, notified: true } },
    });
  }, [data?.lastTimerEvent?.id]);
  useEffect(() => {
    if (
      !data ||
      (data.timer.running &&
        data.timer.phase === "focus" &&
        data.settings.quietDuringFocus)
    )
      return;
    const due = dueIdeas(data, now).filter((i) => !i.notifiedAt);
    if (
      due.length &&
      notify(
        "稍後要做的事",
        due.length === 1 ? due[0].text : `${due.length} 件記下的事等你查看。`,
      )
    )
      send({ type: "notified", ids: due.map((i) => i.id) });
  }, [data, now]);

  if (!data)
    return (
      <div className="loading-screen">
        <span className="brand-mark">f</span>
        <h1>FocusFlow</h1>
        {loadError ? (
          <>
            <p>暫時讀不到你的資料，請確認本機服務仍在執行。</p>
            <button className="primary" onClick={load}>
              重新載入
            </button>
          </>
        ) : (
          <p role="status">正在準備你的工作空間…</p>
        )}
      </div>
    );
  const current = data.tasks.find((t) => t.id === data.currentId && !t.done);
  const elapsed = timerElapsed(data, now);
  const live = liveFocusSeconds(data, now);
  const plan = planSummary(data, now);
  const isBreak = data.timer.phase === "break";
  const isRunning = data.timer.running;
  const isFocusing = isRunning && data.timer.phase === "focus";
  const focusDone = data.timer.phase === "focusDone";
  const breakDone = data.timer.phase === "breakDone";
  const due = dueIdeas(data, now);
  const quiet = isFocusing && data.settings.quietDuringFocus;
  const shownIdeas =
    inboxFilter === "done"
      ? data.ideas.filter((i) => i.done)
      : inboxFilter === "due"
        ? due
        : data.ideas.filter((i) => !i.done);
  const tasks = data.tasks.filter(
    (t) => !t.done && (taskFilter === "all" || t.project === taskFilter),
  );
  const completed = data.tasks.filter((t) => t.done);
  const close = () => {
    setModal(null);
    setCopied(false);
  };
  const pause = () => {
    send({ type: "pause" });
    setModal({ type: "pause" });
  };
  const start = () => {
    send({ type: "start" });
    setIdleDismissed(false);
  };
  const openInbox = () => {
    setFocusMode(false);
    setView("today");
    setInboxFilter("due");
    requestAnimationFrame(() =>
      document.getElementById("inbox-title")?.focus(),
    );
  };
  const taskTotal = (t) => t.totalSec + (t.id === data.currentId ? live : 0);
  const timerDisplay =
    isBreak || data.mode === "pomodoro"
      ? fmtTime(
          Math.max(
            0,
            (data.timer.phase === "focus" && !data.timer.hasStarted
              ? data.settings.focusMinutes * 60
              : data.timer.duration) - elapsed,
          ),
        )
      : fmtTime(elapsed);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setToast("無法自動複製，請在文字框中全選後複製。");
    }
  };
  const exportText =
    modal?.type === "export"
      ? buildExport({
          tasks: data.tasks,
          pauses: data.pauses,
          ideas: data.ideas.filter((i) => !i.done),
          globalNote: data.globalNote,
          currentId: data.currentId,
          elapsed: live,
          now: new Date(now),
        })
      : "";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要內容
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">f</span>
          <span>FocusFlow</span>
        </div>
        <nav className="main-nav" aria-label="主要導覽">
          <button
            className={view === "today" ? "selected" : ""}
            aria-current={view === "today" ? "page" : undefined}
            onClick={() => setView("today")}
          >
            今天
          </button>
          <button
            className={view === "history" ? "selected" : ""}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => setView("history")}
          >
            回顧
          </button>
        </nav>
        <div className="header-end">
          {view === "history" && isFocusing && (
            <button
              className="text-button header-timer"
              onClick={() => setView("today")}
            >
              <Icon name="focus" size={16} />
              <span>專注中 {timerDisplay}</span>
            </button>
          )}
          <span className="date-label">
            {new Date(now).toLocaleDateString("zh-TW", {
              month: "long",
              day: "numeric",
              weekday: "short",
            })}
          </span>
          <button
            className="icon-button"
            title="偏好設定"
            aria-label="偏好設定"
            onClick={() => setModal({ type: "settings" })}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {(saveStatus === "error" || saveStatus === "stale") && (
        <div className="save-error" role="alert">
          <span>
            {saveStatus === "stale"
              ? "資料已在其他地方重置。請先複製未存內容，再重新載入。"
              : "目前尚未存檔，內容仍保留在頁面中。"}
          </span>
          {saveStatus === "error" && (
            <button className="secondary" onClick={() => saver.current.retry()}>
              重試儲存
            </button>
          )}
        </div>
      )}
      {view === "today" ? (
        <>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">留一點空間給自己</p>
              <h1>{focusMode ? "眼前，只做這件事。" : "今天，慢慢完成。"}</h1>
            </div>
            <button
              className="secondary focus-toggle"
              aria-pressed={focusMode}
              onClick={() => setFocusMode(!focusMode)}
            >
              <Icon name="focus" />
              {focusMode ? "回到總覽" : "專注模式"}
            </button>
          </div>
          {due.length > 0 && (
            <div
              className={`reminder-banner ${quiet ? "quiet" : ""}`}
              role="status"
            >
              <Icon name="bell" />
              <span>
                {quiet
                  ? `${due.length} 件事已收好，休息時再提醒。`
                  : `有 ${due.length} 件記下的事，現在可以看看。`}
              </span>
              <button className="text-button" onClick={openInbox}>
                查看
              </button>
            </div>
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className={`workspace ${focusMode ? "focus-only" : ""}`}
          >
            {!focusMode && (
              <aside className="plan-column" aria-label="今日安排">
                <section className="panel task-panel">
                  <div className="panel-heading">
                    <h2>今日安排</h2>
                    <span className="count">
                      {data.tasks.filter((t) => !t.done).length}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="新增任務"
                      onClick={() => setModal({ type: "task" })}
                    >
                      <Icon name="plus" size={18} />
                    </button>
                  </div>
                  <div className="time-budget">
                    <div>
                      <span>
                        還需約 <strong>{Math.ceil(plan.remaining)} 分</strong>
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "settings" })}
                      >
                        可用 {plan.budget / 60} 小時
                      </button>
                    </div>
                    <progress
                      aria-label="今日時間安排"
                      max={plan.budget}
                      value={Math.min(plan.budget, plan.spent + plan.remaining)}
                    />
                    <p className="help">
                      {plan.over > 0
                        ? `比可用時間多約 ${Math.ceil(plan.over)} 分，可以減少安排或調整預估。`
                        : "不必排滿，留一點彈性。"}
                    </p>
                  </div>
                  {data.projects.length > 1 && (
                    <label className="filter-label">
                      專案
                      <select
                        value={taskFilter}
                        onChange={(e) => setTaskFilter(e.target.value)}
                      >
                        <option value="all">所有專案</option>
                        {data.projects.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="task-list">
                    {tasks.map((t) => (
                      <div
                        className={`task-item ${t.id === current?.id ? "current" : ""}`}
                        key={t.id}
                      >
                        <button
                          className="task-select"
                          aria-pressed={t.id === current?.id}
                          onClick={() => send({ type: "select", id: t.id })}
                        >
                          <span className="task-indicator">
                            {t.id === current?.id ? (
                              <Icon name="arrow" size={15} />
                            ) : null}
                          </span>
                          <span className="task-copy">
                            <strong>{t.title}</strong>
                            <span>
                              {t.project} · {t.estimateMin} 分鐘
                            </span>
                          </span>
                        </button>
                        <div className="task-tools">
                          <button
                            className="icon-button"
                            aria-label={`編輯 ${t.title}`}
                            onClick={() =>
                              setModal({ type: "editTask", id: t.id })
                            }
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`將 ${t.title} 提前`}
                            disabled={data.tasks.indexOf(t) === 0}
                            onClick={() =>
                              send({
                                type: "moveTask",
                                id: t.id,
                                direction: -1,
                              })
                            }
                          >
                            <Icon name="up" size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!tasks.length && (
                      <p className="empty-copy">
                        {data.tasks.some((t) => !t.done)
                          ? "這個專案目前沒有待辦。"
                          : "先選一件想完成的小事。"}
                      </p>
                    )}
                  </div>
                  <button
                    className="add-task"
                    onClick={() => setModal({ type: "task" })}
                  >
                    <Icon name="plus" size={18} />
                    新增任務
                  </button>
                  {completed.length > 0 && (
                    <details className="completed-tasks">
                      <summary>已完成 · {completed.length}</summary>
                      {completed.map((t) => (
                        <div key={t.id} className="completed-row">
                          <Icon name="check" size={16} />
                          <span>{t.title}</span>
                          <button
                            className="text-button"
                            onClick={() => send({ type: "reopen", id: t.id })}
                          >
                            恢復
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                  <button
                    className="manage-projects text-button"
                    onClick={() => setModal({ type: "projects" })}
                  >
                    管理專案
                  </button>
                </section>
              </aside>
            )}
            <section className="focus-column" aria-label="當前專注">
              <div
                className={`panel focus-card ${isBreak ? "break-card" : ""}`}
              >
                <div className="focus-card-top">
                  <span className="eyebrow">
                    {isBreak
                      ? "休息時間"
                      : focusDone
                        ? "完成一段專注"
                        : breakDone
                          ? "休息結束"
                          : isFocusing
                            ? "正在專注"
                            : elapsed > 0
                              ? "隨時可以繼續"
                              : "你的下一小步"}
                  </span>
                  {!isBreak && !focusDone && !breakDone && (
                    <div className="segmented" aria-label="計時模式">
                      <button
                        className={data.mode === "pomodoro" ? "selected" : ""}
                        aria-pressed={data.mode === "pomodoro"}
                        onClick={() => send({ type: "mode", mode: "pomodoro" })}
                      >
                        番茄鐘
                      </button>
                      <button
                        className={data.mode === "stopwatch" ? "selected" : ""}
                        aria-pressed={data.mode === "stopwatch"}
                        onClick={() =>
                          send({ type: "mode", mode: "stopwatch" })
                        }
                      >
                        碼表
                      </button>
                    </div>
                  )}
                </div>
                <div className="focus-title">
                  <span className="project-label">
                    {isBreak
                      ? "暫時放下手上的事"
                      : current?.project || "從一件事開始"}
                  </span>
                  <h2>
                    {isBreak
                      ? "走走、喝口水。"
                      : current?.title || "想把注意力放在哪裡？"}
                  </h2>
                </div>
                {!current && !isBreak ? (
                  <div className="focus-empty">
                    <p>加一件小任務，讓接下來的時間有個方向。</p>
                    <button
                      className="primary"
                      onClick={() => setModal({ type: "task" })}
                    >
                      <Icon name="plus" size={18} />
                      安排第一件事
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="timer-area">
                      <div
                        className={`timer ${focusDone || breakDone ? "timer-message" : ""}`}
                        role="timer"
                        aria-label={
                          focusDone || breakDone
                            ? "計時已結束"
                            : isBreak
                              ? "休息剩餘時間"
                              : "專注計時"
                        }
                      >
                        {focusDone
                          ? "辛苦了。"
                          : breakDone
                            ? "準備好了嗎？"
                            : timerDisplay}
                      </div>
                      <p>
                        {focusDone
                          ? "這段時間已經記下，休息後再繼續。"
                          : breakDone
                            ? "不急，準備好再開始下一段。"
                            : isBreak
                              ? "休息不計入專注時間"
                              : data.mode === "pomodoro"
                                ? `一段 ${Math.round((!data.timer.hasStarted ? data.settings.focusMinutes * 60 : data.timer.duration) / 60)} 分鐘的專注`
                                : "照自己的步調，慢慢往前"}
                      </p>
                    </div>
                    {(data.mode === "pomodoro" || isBreak) &&
                      !focusDone &&
                      !breakDone && (
                        <progress
                          className="focus-progress"
                          aria-label={isBreak ? "休息進度" : "本段專注進度"}
                          value={elapsed}
                          max={data.timer.duration}
                        />
                      )}
                    <div className="timer-actions">
                      {isBreak ? (
                        <>
                          <button
                            className="primary"
                            onClick={() =>
                              send({
                                type: isRunning ? "pause" : "resumeBreak",
                              })
                            }
                          >
                            <Icon
                              name={isRunning ? "pause" : "play"}
                              size={18}
                            />
                            {isRunning ? "暫停休息" : "繼續休息"}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => send({ type: "endBreak" })}
                          >
                            結束休息
                          </button>
                        </>
                      ) : focusDone ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => send({ type: "break" })}
                          >
                            <Icon name="cup" size={18} />
                            休息 {data.settings.breakMinutes} 分鐘
                          </button>
                          <button className="secondary" onClick={start}>
                            繼續專注
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="primary"
                            onClick={isFocusing ? pause : start}
                          >
                            <Icon
                              name={isFocusing ? "pause" : "play"}
                              size={18}
                            />
                            {isFocusing
                              ? "暫停一下"
                              : elapsed > 0
                                ? "繼續專注"
                                : "開始專注"}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => {
                              send({ type: "pause" });
                              setModal({ type: "finish", id: current.id });
                            }}
                          >
                            <Icon name="check" size={18} />
                            完成任務
                          </button>
                        </>
                      )}
                    </div>
                    {current && !isBreak && (
                      <div className="focus-foot">
                        <span>這件事已投入 {minutes(taskTotal(current))}</span>
                        <span>預留 {current.estimateMin} 分</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              {isFocusing &&
                data.mode === "stopwatch" &&
                elapsed >= 50 * 60 &&
                !breakDismissed && (
                  <div className="gentle-prompt">
                    <span>已經投入一段時間了，要休息一下嗎？</span>
                    <button
                      className="text-button"
                      onClick={() => send({ type: "break" })}
                    >
                      休息 {data.settings.breakMinutes} 分鐘
                    </button>
                    <button
                      className="icon-button"
                      aria-label="稍後再休息"
                      onClick={() => setBreakDismissed(true)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                )}
              {current &&
                !isRunning &&
                data.timer.phase === "focus" &&
                now - idleSince.current >= 5 * 60000 &&
                !idleDismissed && (
                  <div className="gentle-prompt">
                    <span>準備好回到「{current.title}」了嗎？</span>
                    <button className="text-button" onClick={start}>
                      繼續
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setIdleDismissed(true)}
                    >
                      稍後
                    </button>
                  </div>
                )}
              <div className="capture-strip">
                <Icon name="note" />
                <button onClick={() => setModal({ type: "capture" })}>
                  想到別的事？先記下來。
                </button>
                <kbd>⌘ / Ctrl ⇧ K</kbd>
              </div>
              {current && (
                <section className="panel next-step">
                  <div className="panel-heading">
                    <h2>下一小步</h2>
                    <span className="muted">接著做什麼</span>
                  </div>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (step.trim()) {
                        send({
                          type: "updateTask",
                          id: current.id,
                          patch: {
                            steps: [
                              ...(current.steps || []),
                              { text: step.trim(), time: nowHM() },
                            ],
                          },
                        });
                        setStep("");
                      }
                    }}
                  >
                    <input
                      aria-label="新增下一步"
                      value={step}
                      onChange={(e) => setStep(e.target.value)}
                      placeholder="寫下一個小動作…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isComposing(e))
                          e.preventDefault();
                      }}
                    />
                    <button
                      className="icon-button"
                      aria-label="加入下一步"
                      disabled={!step.trim()}
                    >
                      <Icon name="plus" size={18} />
                    </button>
                  </form>
                  {(current.steps || []).map((s, i) => (
                    <div className="step-row" key={i}>
                      <span>{s.text}</span>
                      <time>{s.time}</time>
                      <button
                        className="icon-button"
                        aria-label={`移除步驟：${s.text}`}
                        onClick={() =>
                          send({
                            type: "updateTask",
                            id: current.id,
                            patch: {
                              steps: current.steps.filter((_, j) => i !== j),
                            },
                          })
                        }
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {!focusMode && (
                <NoteArea data={data} current={current} send={send} />
              )}
              {!focusMode && (
                <details className="panel interruption-panel">
                  <summary>
                    今日中斷紀錄{" "}
                    <span className="muted">{data.pauses.length} 次</span>
                  </summary>
                  <div className="detail-body">
                    {!data.pauses.length && (
                      <p className="help">
                        還沒有紀錄。需要暫停時，隨時可以停下來。
                      </p>
                    )}
                    {data.pauses.map((p, i) => (
                      <p className="log-line" key={i}>
                        <time>{p.time}</time>
                        <span>
                          {p.reason} · {p.task}
                        </span>
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </section>
            {!focusMode && (
              <aside className="inbox-column" aria-label="稍後再想">
                <section className="panel inbox-panel">
                  <div className="panel-heading">
                    <h2 id="inbox-title" tabIndex="-1">
                      稍後再想
                    </h2>
                    <span className="count">
                      {data.ideas.filter((i) => !i.done).length}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="快速記下想法"
                      onClick={() => setModal({ type: "capture" })}
                    >
                      <Icon name="plus" size={18} />
                    </button>
                  </div>
                  <p className="panel-description">
                    先把念頭放下，需要時再回來。
                  </p>
                  <div className="inbox-filters" aria-label="收集箱篩選">
                    {[
                      ["open", "待整理"],
                      ["due", `待提醒${due.length ? ` ${due.length}` : ""}`],
                      ["done", "已處理"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={inboxFilter === id ? "selected" : ""}
                        aria-pressed={inboxFilter === id}
                        onClick={() => setInboxFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="idea-list">
                    {!shownIdeas.length && (
                      <div className="inbox-empty">
                        <Icon name="note" size={28} />
                        <p>
                          {inboxFilter === "due"
                            ? "現在沒有待提醒的事。"
                            : inboxFilter === "done"
                              ? "處理過的事會留在這裡。"
                              : "想到什麼，都可以先放這裡。"}
                        </p>
                        <span>不用急著處理。</span>
                      </div>
                    )}
                    {shownIdeas.map((i) => (
                      <article
                        className={`idea-item ${due.some((d) => d.id === i.id) ? "due" : ""}`}
                        key={i.id}
                      >
                        <p>{i.text}</p>
                        <button
                          className="idea-reminder"
                          disabled={i.done}
                          onClick={() =>
                            setModal({ type: "schedule", id: i.id })
                          }
                        >
                          <Icon name="bell" size={14} />
                          {due.some((d) => d.id === i.id)
                            ? "現在可以看看"
                            : reminderLabel(i)}
                        </button>
                        <div className="idea-actions">
                          <button
                            className="text-button"
                            onClick={() => send({ type: "ideaDone", id: i.id })}
                          >
                            {i.done ? "恢復待整理" : "已處理"}
                          </button>
                          {i.done && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setModal({ type: "deleteIdea", id: i.id })
                              }
                            >
                              刪除
                            </button>
                          )}
                          {!i.done && (
                            <>
                              <button
                                className="text-button"
                                onClick={() => {
                                  send({ type: "promote", id: i.id });
                                  setToast("已加入今日安排。");
                                }}
                              >
                                轉為任務
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  send({ type: "ideaSnooze", id: i.id })
                                }
                              >
                                10 分後
                              </button>
                              <details className="idea-more">
                                <summary aria-label={`更多操作：${i.text}`}>
                                  更多
                                </summary>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setModal({ type: "prompt", text: i.text })
                                  }
                                >
                                  AI 整理
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    send({ type: "ideaDismiss", id: i.id })
                                  }
                                >
                                  取消提醒
                                </button>
                              </details>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </aside>
            )}
          </main>
          {!focusMode && (
            <footer className="daily-footer">
              <span>
                今天已專注 <strong>{minutes(plan.spent * 60)}</strong>
              </span>
              <span>
                完成 <strong>{completed.length}</strong> 件事
              </span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "export" })}
              >
                匯出今日紀錄
              </button>
              <span className="save-status" role="status">
                {saveStatus === "saved"
                  ? "已儲存"
                  : saveStatus === "saving"
                    ? "儲存中…"
                    : "尚未儲存"}
              </span>
            </footer>
          )}
        </>
      ) : (
        <History data={data} now={now} />
      )}
      <button
        className="capture-fab"
        onClick={() => setModal({ type: "capture" })}
        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
      >
        <Icon name="plus" size={18} />
        <span>快速記下</span>
      </button>
      <div className={`toast ${toast ? "visible" : ""}`} role="status">
        {toast}
      </div>
      {modal && (
        <Modal
          title={
            {
              task: "安排一件事",
              editTask: "調整任務",
              capture: "快速記下",
              schedule: "調整提醒",
              finish: "完成這件事",
              pause: "已暫停，喘口氣。",
              settings: "照自己的步調",
              projects: "管理專案",
              export: "今日紀錄",
              prompt: "把想法整理成任務",
              deleteIdea: "刪除這則紀錄？",
            }[modal.type]
          }
          onClose={close}
          wide={["export", "prompt"].includes(modal.type)}
        >
          {(modal.type === "task" || modal.type === "editTask") && (
            <TaskForm
              projects={data.projects}
              initialProject={data.newTaskProj}
              task={data.tasks.find((t) => t.id === modal.id)}
              onClose={close}
              onSave={(values) => {
                send(
                  modal.type === "editTask"
                    ? { type: "updateTask", id: modal.id, patch: values }
                    : { type: "addTask", ...values },
                );
                close();
              }}
            />
          )}
          {(modal.type === "capture" || modal.type === "schedule") && (
            <CaptureForm
              data={data}
              idea={data.ideas.find((i) => i.id === modal.id)}
              draft={captureDraft}
              setDraft={setCaptureDraft}
              onSave={(idea) => {
                send(
                  modal.type === "schedule"
                    ? {
                        type: "ideaSchedule",
                        id: modal.id,
                        ...{
                          reminder: idea.reminder,
                          remindAt: idea.remindAt,
                          readyAt: idea.readyAt,
                        },
                      }
                    : { type: "capture", idea },
                );
                if (modal.type === "capture") setCaptureDraft("");
                close();
                setToast(
                  modal.type === "schedule"
                    ? "提醒時間已更新。"
                    : "記下了，回到眼前的事。",
                );
              }}
            />
          )}
          {modal.type === "finish" &&
            data.tasks.some((t) => t.id === modal.id) && (
              <FinishForm
                task={data.tasks.find((t) => t.id === modal.id)}
                elapsed={modal.id === data.currentId ? live : 0}
                onSave={(summary, adjust) => {
                  send({ type: "complete", id: modal.id, summary, adjust });
                  close();
                  setToast("完成了一件事，留一點空間給自己。");
                }}
              />
            )}
          {modal.type === "pause" && (
            <>
              <p className="dialog-intro">想記下原因嗎？可以直接略過。</p>
              <div className="reason-options">
                {["會議", "訊息回覆", "被打斷", "分心了", "休息", "換任務"].map(
                  (reason) => (
                    <button
                      key={reason}
                      className="secondary"
                      onClick={() => {
                        send({ type: "reason", reason });
                        close();
                      }}
                    >
                      {reason}
                    </button>
                  ),
                )}
              </div>
              <div className="dialog-actions">
                <button className="text-button" onClick={close}>
                  略過
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    send({ type: "break" });
                    close();
                  }}
                >
                  休息 {data.settings.breakMinutes} 分鐘
                </button>
              </div>
            </>
          )}
          {modal.type === "deleteIdea" && (
            <>
              <p className="dialog-intro">
                {data.ideas.find((i) => i.id === modal.id)?.text}
              </p>
              <p className="help">
                刪除後無法復原；也可以關閉視窗，把它留在已處理中。
              </p>
              <div className="dialog-actions">
                <button className="secondary" onClick={close}>
                  保留
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    send({ type: "ideaRemove", id: modal.id });
                    close();
                  }}
                >
                  刪除紀錄
                </button>
              </div>
            </>
          )}
          {modal.type === "settings" && (
            <Settings data={data} send={send} notice={setToast} />
          )}
          {modal.type === "projects" && (
            <ProjectManager data={data} send={send} />
          )}
          {(modal.type === "export" || modal.type === "prompt") && (
            <>
              <p className="help">複製後可以直接貼給 AI 整理。</p>
              <textarea
                className="export-text"
                aria-label="可複製文字"
                readOnly
                rows={13}
                value={
                  modal.type === "export"
                    ? exportText
                    : buildIdeaPrompt(modal.text)
                }
              />
              <div className="dialog-actions">
                <button
                  className="primary"
                  onClick={() =>
                    copy(
                      modal.type === "export"
                        ? exportText
                        : buildIdeaPrompt(modal.text),
                    )
                  }
                >
                  {copied ? "已複製" : "複製文字"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
