import React from 'react';
import { loadData, createSaver } from './api.js';
import {
  todayKey, fmtTime, nowHM, parseStyle,
  byProject, computeToday, computeAnalytics,
  buildExport, buildIdeaPrompt, applyRollover,
} from './logic.js';

const S = parseStyle; // style() — copy design css strings verbatim

// Fixed config (design data-props defaults).
const POMO_MIN = 25;
const BREAK_MIN = 50;
const IDLE_MIN = 5;

// Fields that live in data/focusflow.json.
const PERSIST_KEYS = [
  'projects', 'newTaskProj', 'currentId', 'mode', 'tab',
  'globalNote', 'tasks', 'ideas', 'replies', 'pauses', 'history', 'activeDate',
];

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loaded: false,
      now: Date.now(),
      // persisted
      projects: ['未分類'],
      newTaskProj: '未分類',
      currentId: null,
      mode: 'stopwatch',
      tab: 'notes',
      globalNote: '',
      tasks: [],
      ideas: [],
      replies: [],
      pauses: [],
      history: [],
      activeDate: null,
      // timer (transient; Date.now based)
      running: false,
      runStartMs: 0,
      elapsedBase: 0,
      idleSinceMs: Date.now(),
      breakDismissed: false,
      idleDismissed: false,
      // UI drafts / modals
      newTask: '', nextStep: '', captureText: '', newReply: '', newProj: '',
      showCapture: false, showPause: false, showExport: false, showProjMgr: false, showFinish: false,
      finishSummary: '', finishAdjust: '',
      copied: false, ideaPromptFor: null, ideaCopied: false,
      view: 'today', selDay: 0,
    };
    this.saver = createSaver(500);
    this._lastSerialized = '';
    // Autosave is disabled until data is successfully loaded, so a failed load
    // (or the empty initial state) can never overwrite good data on disk.
    this._ready = false;
  }

  async componentDidMount() {
    try {
      const raw = await loadData();
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) {
        throw new Error('unexpected data shape');
      }
      const data = applyRollover(raw, todayKey());
      const next = { loaded: true, now: Date.now(), running: false, runStartMs: 0, idleSinceMs: Date.now() };
      for (const k of PERSIST_KEYS) if (k in data) next[k] = data[k];
      next.elapsedBase = data.elapsed || 0;
      this.setState(next, () => {
        this._lastSerialized = this.serialize(false);
        this._ready = true; // only now is autosave allowed
      });
    } catch (e) {
      // Load failed: render an empty shell but keep autosave OFF (_ready stays
      // false) so we never clobber the on-disk file with empty state.
      console.error('[focusflow] load failed — autosave disabled to protect data', e);
      this.setState({ loaded: true });
    }
    this.timer = setInterval(() => this.setState({ now: Date.now() }), 1000);
    this.keyHandler = (e) => { if (e.key === 'Escape') this.setState({ showCapture: false, showPause: false }); };
    window.addEventListener('keydown', this.keyHandler);
    // schedule() must receive a plain OBJECT (the saver stringifies once);
    // passing the serialized string here caused a double-encoded file.
    this.flushHandler = () => { if (this._ready) { this.saver.schedule(JSON.parse(this.serialize(true))); this.saver.flush(); } };
    this.visHandler = () => { if (document.visibilityState === 'hidden') this.flushHandler(); };
    window.addEventListener('beforeunload', this.flushHandler);
    document.addEventListener('visibilitychange', this.visHandler);
  }

  componentDidUpdate() {
    if (!this._ready) return;
    const ser = this.serialize(false);
    if (ser !== this._lastSerialized) {
      this._lastSerialized = ser;
      this.saver.schedule(JSON.parse(ser));
    }
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('beforeunload', this.flushHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
  }

  // Persisted snapshot as a JSON string (excludes clock/timer/UI so ticks
  // don't trigger saves). `live=true` commits the in-progress timer segment.
  serialize(live) {
    const s = this.state;
    const out = { elapsed: live ? this.elapsedSec() : s.elapsedBase };
    for (const k of PERSIST_KEYS) out[k] = s[k];
    return JSON.stringify(out);
  }

  // ---- timer math (wall-clock based, survives tab throttling) ----
  elapsedSec() {
    const s = this.state;
    if (s.running && s.runStartMs) return s.elapsedBase + Math.floor((Date.now() - s.runStartMs) / 1000);
    return s.elapsedBase;
  }
  idleSecVal() {
    if (this.state.running) return 0;
    return Math.floor((Date.now() - this.state.idleSinceMs) / 1000);
  }

  projColor(name) {
    const hues = { '產品規劃': '#6fa3e0', '設計協作': '#7fd0c0', '用戶研究': '#c0a5e8', '未分類': '#8fa2bd', '來自 Idea': '#e0c07f' };
    if (hues[name]) return hues[name];
    const palette = ['#7fb0d8', '#8ec9a8', '#b8a8dd', '#d8b98a', '#89bcc9', '#c99ab0'];
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
    return palette[h % palette.length];
  }
  cur() { return this.state.tasks.find((t) => t.id === this.state.currentId) || this.state.tasks[0]; }
  updateCur(patch) {
    this.setState((s) => ({ tasks: s.tasks.map((t) => t.id === s.currentId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t) }));
  }
  renameProj(oldName, newName) {
    this.setState((s) => ({
      projects: s.projects.map((p) => p === oldName ? newName : p),
      tasks: s.tasks.map((t) => t.project === oldName ? { ...t, project: newName } : t),
      newTaskProj: s.newTaskProj === oldName ? newName : s.newTaskProj,
    }));
  }
  doPause(reason) {
    const cur = this.cur();
    const frozen = this.elapsedSec();
    this.setState((s) => ({
      running: false, runStartMs: 0, elapsedBase: frozen,
      showPause: false, idleSinceMs: Date.now(), idleDismissed: false,
      pauses: [{ time: nowHM(), reason: reason || '未填原因', task: cur ? cur.title : '' }, ...s.pauses],
    }));
  }

  render() {
    if (!this.state.loaded) {
      return <div style={S('min-height:100vh;display:flex;align-items:center;justify-content:center;color:#5b6a80;font-size:14px;')}>載入中…</div>;
    }
    const v = this.renderVals();
    const chip = (on) => on
      ? S('white-space:nowrap;background:#233b5e;border:none;color:#d5e3f6;border-radius:7px;padding:5px 14px;font-size:12.5px;font-weight:600;cursor:pointer;')
      : S('white-space:nowrap;background:none;border:none;color:#6d7c92;border-radius:7px;padding:5px 14px;font-size:12.5px;font-weight:400;cursor:pointer;');

    return (
      <div style={S('min-height:100vh;display:flex;flex-direction:column;background:#0c111b;')}>
        {/* Header */}
        <header style={S('display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid #1a2333;')}>
          <div style={S('display:flex;align-items:center;gap:12px;')}>
            <div style={S('width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#2c4a75,#1a2c49);display:flex;align-items:center;justify-content:center;color:#9fbfe6;font-weight:600;font-size:13px;')}>F</div>
            <div style={S('font-weight:600;font-size:15px;color:#dde6f2;')}>FocusFlow</div>
            <div style={S('font-size:12px;color:#5b6a80;')}>解放大腦的記憶空間</div>
            <div style={S('display:flex;background:#0c1420;border:1px solid #1d2839;border-radius:9px;padding:3px;gap:3px;margin-left:14px;')}>
              <button onClick={v.viewToday} style={chip(v.onToday)}>今天</button>
              <button onClick={v.viewHistory} style={chip(v.onHistory)}>歷史與分析</button>
            </div>
          </div>
          <div style={S('display:flex;align-items:baseline;gap:14px;')}>
            <div style={S('font-size:13px;color:#74849b;')}>{v.clockDate}</div>
            <div style={S("font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:500;color:#dde6f2;letter-spacing:1px;")}>{v.clockTime}</div>
          </div>
        </header>

        {/* Reminder banners */}
        {v.showBreakReminder && (
          <div style={S('display:flex;align-items:center;gap:12px;margin:14px 28px 0;padding:10px 16px;border-radius:10px;background:#1c2a42;border:1px solid #33507e;color:#a9c6ea;font-size:13.5px;')}>
            <span style={S('width:8px;height:8px;border-radius:50%;background:#6fa3e0;animation:pulseDot 2s infinite;')}></span>
            已連續專注 {v.elapsedMin} 分鐘，建議起來走走、喝口水，休息 5 分鐘再回來。
            <button onClick={v.dismissBreak} style={S('margin-left:auto;background:none;border:1px solid #33507e;color:#a9c6ea;border-radius:7px;padding:4px 12px;font-size:12.5px;cursor:pointer;')}>知道了</button>
          </div>
        )}
        {v.showIdleReminder && (
          <div style={S('display:flex;align-items:center;gap:12px;margin:14px 28px 0;padding:10px 16px;border-radius:10px;background:#2a2438;border:1px solid #4a3f66;color:#c3b6e0;font-size:13.5px;')}>
            <span style={S('width:8px;height:8px;border-radius:50%;background:#a08ad0;animation:pulseDot 2s infinite;')}></span>
            已經 {v.idleMin} 分鐘沒有在計時了——要回到「{v.currentTitle}」嗎？
            <button onClick={v.startTimer} style={S('margin-left:auto;background:#4a3f66;border:none;color:#e6def5;border-radius:7px;padding:5px 14px;font-size:12.5px;cursor:pointer;')}>繼續任務</button>
            <button onClick={v.dismissIdle} style={S('background:none;border:1px solid #4a3f66;color:#c3b6e0;border-radius:7px;padding:4px 12px;font-size:12.5px;cursor:pointer;')}>稍後</button>
          </div>
        )}

        {v.onHistory && this.renderHistory(v)}
        {v.onToday && this.renderToday(v)}

        {/* Floating quick capture */}
        <button onClick={v.openCapture} title="快速記錄 idea" style={S('position:fixed;right:30px;bottom:30px;width:58px;height:58px;border-radius:50%;background:#2c4a75;border:none;color:#e3eefb;font-size:26px;cursor:pointer;box-shadow:0 8px 26px rgba(20,45,85,.55);display:flex;align-items:center;justify-content:center;')}>＋</button>

        {this.renderModals(v)}
      </div>
    );
  }

  renderToday(v) {
    return (
      <main style={S('flex:1;display:flex;flex-wrap:wrap;gap:18px;padding:18px 28px 90px;align-items:flex-start;')}>
        {/* Left: tasks */}
        <section style={S('flex:1 1 250px;max-width:340px;min-width:250px;display:flex;flex-direction:column;gap:10px;')}>
          <div style={S('display:flex;align-items:baseline;justify-content:space-between;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;letter-spacing:.5px;')}>今日任務</div>
            <div style={S('font-size:12px;color:#5b6a80;')}>{v.doneCount}/{v.taskCount} 完成</div>
          </div>
          {v.taskItems.map((t) => (
            <div key={t.id} onClick={t.select} style={t.cardStyle}>
              <div style={S('display:flex;align-items:center;gap:10px;')}>
                <button onClick={t.toggle} style={t.checkStyle}>{t.checkMark}</button>
                <div style={S('flex:1;min-width:0;')}>
                  <div style={t.titleStyle}>{t.title}</div>
                  <div style={S('display:flex;gap:8px;align-items:center;margin-top:3px;')}>
                    <span onClick={t.cycleProject} title="點擊切換專案" style={t.projChipStyle}>{t.project}</span>
                    <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11px;color:#5b6a80;")}>{t.timeText}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div style={S('display:flex;flex-direction:column;gap:8px;')}>
            <input value={v.newTask} onChange={v.setNewTask} onKeyDown={v.newTaskKey} placeholder="新增任務，Enter 送出" style={S('background:#111927;border:1px solid #1d2839;border-radius:9px;padding:9px 12px;color:#c6d1e0;font-size:13px;outline:none;')} />
            <div style={S('display:flex;flex-wrap:wrap;gap:6px;')}>
              {v.projChips.map((pc) => (
                <button key={pc.name} onClick={pc.pick} style={pc.style}>{pc.name}</button>
              ))}
              <button onClick={v.openProjMgr} title="管理專案" style={S('background:none;border:1px dashed #24334c;color:#5b6a80;border-radius:7px;padding:3px 10px;font-size:11.5px;cursor:pointer;')}>✎ 管理</button>
            </div>
          </div>

          {/* Today stats */}
          <div style={S('margin-top:6px;background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;')}>
            <div style={S('display:flex;align-items:baseline;justify-content:space-between;')}>
              <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>今日統計</div>
              <div style={S("font-family:'IBM Plex Mono',monospace;font-size:12px;color:#6fa3e0;")}>{v.statsTotal}</div>
            </div>
            <div style={S('display:flex;gap:14px;font-size:12px;color:#74849b;')}>
              <span>完成 <span style={S('color:#c6d1e0;font-weight:600;')}>{v.doneCount}</span></span>
              <span>中斷 <span style={S('color:#c6d1e0;font-weight:600;')}>{v.pauseCount}</span></span>
              <span>Idea <span style={S('color:#c6d1e0;font-weight:600;')}>{v.ideaCount}</span></span>
            </div>
            <div style={S('display:flex;flex-direction:column;gap:8px;')}>
              {v.statItems.map((st, i) => (
                <div key={i} style={S('display:flex;flex-direction:column;gap:4px;')}>
                  <div style={S('display:flex;justify-content:space-between;font-size:12px;')}>
                    <span style={S('color:#9dabc2;')}>{st.name}</span>
                    <span style={S("font-family:'IBM Plex Mono',monospace;color:#6d7c92;")}>{st.timeText}</span>
                  </div>
                  <div style={S('height:5px;border-radius:3px;background:#182234;overflow:hidden;')}>
                    <div style={st.barStyle}></div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={v.openExport} style={S('background:#182640;border:1px solid #24334c;color:#a9c6ea;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;')}>📋 匯出日報 Prompt</button>
          </div>
        </section>

        {/* Center: focus card */}
        <section style={S('flex:2 1 420px;min-width:380px;display:flex;flex-direction:column;gap:14px;')}>
          <div style={S('background:#111927;border:1px solid #1d2c44;border-radius:16px;padding:26px 30px;display:flex;flex-direction:column;gap:18px;')}>
            <div style={S('display:flex;align-items:center;justify-content:space-between;')}>
              <div style={S('display:flex;align-items:center;gap:10px;')}>
                <span style={v.statusDotStyle}></span>
                <span style={S('font-size:12.5px;font-weight:600;letter-spacing:1px;color:#8fa2bd;')}>{v.statusLabel}</span>
              </div>
              <div style={S('display:flex;background:#0c1420;border:1px solid #1d2839;border-radius:9px;padding:3px;gap:3px;')}>
                <button onClick={v.setModeStopwatch} style={v.modeBtnStopwatch}>碼表</button>
                <button onClick={v.setModePomodoro} style={v.modeBtnPomodoro}>番茄鐘</button>
              </div>
            </div>
            <div>
              <div style={S('font-size:22px;font-weight:600;color:#e6edf7;line-height:1.35;')}>{v.currentTitle}</div>
              <div style={S('font-size:13px;color:#6fa3e0;margin-top:4px;')}>{v.currentProject}</div>
            </div>
            <div style={S('display:flex;align-items:flex-end;gap:24px;')}>
              <div style={S("font-family:'IBM Plex Mono',monospace;font-size:64px;font-weight:500;color:#dfe9f6;letter-spacing:2px;line-height:1;")}>{v.timerText}</div>
              <div style={S('padding-bottom:8px;font-size:12.5px;color:#5b6a80;')}>{v.timerSubText}</div>
            </div>
            {v.isPomodoro && (
              <div style={S('height:5px;border-radius:3px;background:#182234;overflow:hidden;')}>
                <div style={v.pomoBarStyle}></div>
              </div>
            )}
            <div style={S('display:flex;gap:10px;flex-wrap:wrap;')}>
              {v.running && (
                <button onClick={v.openPause} style={S('flex:0 0 auto;white-space:nowrap;background:#233b5e;border:none;color:#cfe0f5;border-radius:10px;padding:11px 30px;font-size:14.5px;font-weight:600;cursor:pointer;')}>⏸ 暫停</button>
              )}
              {v.notRunning && (
                <button onClick={v.startTimer} style={S('flex:0 0 auto;white-space:nowrap;background:#2c4a75;border:none;color:#e3eefb;border-radius:10px;padding:11px 30px;font-size:14.5px;font-weight:600;cursor:pointer;')}>▶ 開始專注</button>
              )}
              <button onClick={v.finishTask} style={S('white-space:nowrap;background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:10px;padding:11px 20px;font-size:13.5px;cursor:pointer;')}>✓ 完成任務</button>
              <div style={S('margin-left:auto;align-self:center;font-size:12.5px;color:#5b6a80;')}>今日累積 <span style={S("font-family:'IBM Plex Mono',monospace;color:#8fa2bd;")}>{v.todayTotal}</span></div>
            </div>
          </div>

          {/* Next-step capture */}
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:10px;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>下一步 / 腦中冒出的想法</div>
            <input value={v.nextStep} onChange={v.setNextStep} onKeyDown={v.nextStepKey} placeholder="想到什麼先寫下來，Enter 記錄，不用中斷手上的事" style={S('background:#0c1420;border:1px solid #1d2839;border-radius:9px;padding:10px 13px;color:#c6d1e0;font-size:13.5px;outline:none;')} />
            {v.stepItems.map((s, i) => (
              <div key={i} style={S('display:flex;align-items:center;gap:10px;font-size:13.5px;color:#b3c2d8;')}>
                <span style={S('color:#4d6a99;')}>›</span>
                <span style={S('flex:1;')}>{s.text}</span>
                <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11px;color:#4d5b70;")}>{s.time}</span>
                <button onClick={s.remove} style={S('background:none;border:none;color:#4d5b70;cursor:pointer;font-size:14px;')}>×</button>
              </div>
            ))}
          </div>

          {/* Interruption log */}
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:8px;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>今日中斷紀錄</div>
            {v.noPauses && <div style={S('font-size:12.5px;color:#4d5b70;')}>還沒有中斷，狀態很好。</div>}
            {v.pauseItems.map((p, i) => (
              <div key={i} style={S('display:flex;align-items:center;gap:10px;font-size:13px;color:#9dabc2;')}>
                <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#5b6a80;")}>{p.time}</span>
                <span style={S('background:#1a2333;border-radius:5px;padding:1px 8px;font-size:12px;color:#8fa2bd;')}>{p.reason}</span>
                <span style={S('font-size:12px;color:#5b6a80;')}>{p.task}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right: ideas + notes */}
        <section style={S('flex:1 1 290px;min-width:280px;display:flex;flex-direction:column;gap:14px;')}>
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;')}>
            <div style={S('display:flex;align-items:baseline;justify-content:space-between;')}>
              <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>💡 Idea 收集箱</div>
              <div style={S('font-size:11.5px;color:#5b6a80;')}>之後可開成任務</div>
            </div>
            {v.noIdeas && <div style={S('font-size:12.5px;color:#4d5b70;')}>用右下角的按鈕快速記下靈感。</div>}
            {v.ideaItems.map((i, idx) => (
              <div key={idx} style={S('background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;')}>
                <div style={S('font-size:13.5px;color:#c0cee2;line-height:1.45;')}>{i.text}</div>
                <div style={S('display:flex;gap:8px;align-items:center;')}>
                  <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11px;color:#4d5b70;")}>{i.time}</span>
                  <button onClick={i.aiPrompt} title="複製 prompt 請 AI 整理成可執行的分階段任務" style={S('margin-left:auto;background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:7px;padding:3px 10px;font-size:12px;cursor:pointer;')}>AI 整理</button>
                  <button onClick={i.promote} style={S('background:#182640;border:none;color:#7fb0e6;border-radius:7px;padding:4px 11px;font-size:12px;cursor:pointer;')}>開成任務 →</button>
                  <button onClick={i.remove} style={S('background:none;border:none;color:#4d5b70;cursor:pointer;font-size:14px;')}>×</button>
                </div>
              </div>
            ))}
          </div>

          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;')}>
            <div style={S('display:flex;gap:4px;background:#0c1420;border:1px solid #1a2333;border-radius:9px;padding:3px;')}>
              <button onClick={v.tabNotes} style={v.tabNotesStyle}>筆記</button>
              <button onClick={v.tabReplies} style={v.tabRepliesStyle}>待回覆訊息</button>
            </div>
            {v.onNotesTab && (
              <textarea value={v.globalNote} onChange={v.setGlobalNote} placeholder="隨手記：會議重點、暫存的文字、任何不想佔用腦容量的東西…" style={S('min-height:170px;resize:vertical;background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:12px 13px;color:#c6d1e0;font-size:13.5px;line-height:1.6;outline:none;')} />
            )}
            {v.onRepliesTab && (
              <>
                <input value={v.newReply} onChange={v.setNewReply} onKeyDown={v.newReplyKey} placeholder="要回覆誰＋什麼事，Enter 加入" style={S('background:#0c1420;border:1px solid #1a2333;border-radius:9px;padding:9px 12px;color:#c6d1e0;font-size:13px;outline:none;')} />
                {v.replyItems.map((r, i) => (
                  <div key={i} style={S('display:flex;align-items:center;gap:10px;font-size:13.5px;')}>
                    <button onClick={r.toggle} style={r.checkStyle}>{r.checkMark}</button>
                    <span style={r.textStyle}>{r.text}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;gap:8px;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>任務筆記 — {v.currentTitle}</div>
            <textarea value={v.taskNote} onChange={v.setTaskNote} placeholder="這個任務專屬的筆記、連結、進度…" style={S('min-height:90px;resize:vertical;background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:11px 13px;color:#c6d1e0;font-size:13px;line-height:1.6;outline:none;')} />
          </div>
        </section>
      </main>
    );
  }

  renderHistory(v) {
    return (
      <main style={S('flex:1;display:flex;flex-wrap:wrap;gap:18px;padding:18px 28px 90px;align-items:flex-start;')}>
        {/* Day list */}
        <section style={S('flex:1 1 250px;max-width:320px;min-width:240px;display:flex;flex-direction:column;gap:10px;')}>
          <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;letter-spacing:.5px;')}>每日紀錄</div>
          {v.dayItems.map((d, i) => (
            <div key={i} onClick={d.select} style={d.cardStyle}>
              <div style={S('display:flex;justify-content:space-between;align-items:baseline;')}>
                <span style={d.dateStyle}>{d.dateText}</span>
                <span style={S("font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:#6fa3e0;")}>{d.totalText}</span>
              </div>
              <div style={S('display:flex;gap:12px;margin-top:5px;font-size:11.5px;color:#5b6a80;')}>
                <span>完成 {d.done}</span><span>中斷 {d.interrupts}</span>
              </div>
            </div>
          ))}
        </section>

        {/* Day detail */}
        <section style={S('flex:2 1 380px;min-width:340px;display:flex;flex-direction:column;gap:14px;')}>
          <div style={S('background:#111927;border:1px solid #1d2c44;border-radius:16px;padding:20px 24px;display:flex;flex-direction:column;gap:14px;')}>
            <div style={S('display:flex;justify-content:space-between;align-items:baseline;')}>
              <div style={S('font-size:16px;font-weight:600;color:#dfe9f6;')}>{v.selDayTitle}</div>
              <div style={S("font-family:'IBM Plex Mono',monospace;font-size:14px;color:#6fa3e0;")}>專注 {v.selDayTotal}</div>
            </div>
            <div style={S('display:flex;flex-direction:column;gap:8px;')}>
              <div style={S('font-size:12.5px;font-weight:600;color:#8fa2bd;')}>任務</div>
              {v.selDayTasks.map((t, i) => (
                <div key={i} style={S('display:flex;align-items:center;gap:10px;font-size:13px;')}>
                  <span style={t.dotStyle}></span>
                  <span style={S('flex:1;color:#b3c2d8;')}>{t.title}</span>
                  <span style={S('font-size:11px;color:#6fa3e0;background:#182640;border-radius:5px;padding:1px 7px;')}>{t.project}</span>
                  <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#5b6a80;")}>{t.timeText}</span>
                </div>
              ))}
            </div>
            <div style={S('display:flex;flex-direction:column;gap:8px;')}>
              <div style={S('font-size:12.5px;font-weight:600;color:#8fa2bd;')}>中斷紀錄</div>
              {v.selDayNoPauses && <div style={S('font-size:12.5px;color:#4d5b70;')}>這天沒有中斷。</div>}
              {v.selDayPauses.map((p, i) => (
                <div key={i} style={S('display:flex;align-items:center;gap:10px;font-size:13px;color:#9dabc2;')}>
                  <span style={S("font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#5b6a80;")}>{p.time}</span>
                  <span style={S('background:#1a2333;border-radius:5px;padding:1px 8px;font-size:12px;color:#8fa2bd;')}>{p.reason}</span>
                  <span style={S('font-size:12px;color:#5b6a80;')}>{p.task}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Analytics */}
        <section style={S('flex:1 1 290px;min-width:280px;display:flex;flex-direction:column;gap:14px;')}>
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;')}>
            <div style={S('display:flex;justify-content:space-between;align-items:baseline;')}>
              <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>7 日專注趨勢</div>
              <div style={S('font-size:11.5px;color:#5b6a80;')}>日均 {v.avgDaily}</div>
            </div>
            <div style={S('display:flex;align-items:flex-end;gap:8px;height:110px;')}>
              {v.trendItems.map((tr, i) => (
                <div key={i} style={S('flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end;')}>
                  <div style={S("font-size:10px;color:#5b6a80;font-family:'IBM Plex Mono',monospace;")}>{tr.hours}</div>
                  <div style={tr.barStyle}></div>
                  <div style={S('font-size:10.5px;color:#5b6a80;')}>{tr.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>中斷原因分析（7 日）</div>
            {v.reasonStats.map((rs, i) => (
              <div key={i} style={S('display:flex;flex-direction:column;gap:4px;')}>
                <div style={S('display:flex;justify-content:space-between;font-size:12px;')}>
                  <span style={S('color:#9dabc2;')}>{rs.reason}</span>
                  <span style={S("font-family:'IBM Plex Mono',monospace;color:#6d7c92;")}>{rs.count} 次</span>
                </div>
                <div style={S('height:5px;border-radius:3px;background:#182234;overflow:hidden;')}>
                  <div style={rs.barStyle}></div>
                </div>
              </div>
            ))}
            <div style={S('font-size:11.5px;color:#5b6a80;line-height:1.5;')}>{v.insightText}</div>
          </div>
          <div style={S('background:#111927;border:1px solid #1d2839;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;')}>
            <div style={S('font-size:13px;font-weight:600;color:#8fa2bd;')}>各專案工時（7 日）</div>
            {v.projStats.map((ps, i) => (
              <div key={i} style={S('display:flex;flex-direction:column;gap:4px;')}>
                <div style={S('display:flex;justify-content:space-between;font-size:12px;')}>
                  <span style={S('color:#9dabc2;')}>{ps.name}</span>
                  <span style={S("font-family:'IBM Plex Mono',monospace;color:#6d7c92;")}>{ps.timeText}</span>
                </div>
                <div style={S('height:5px;border-radius:3px;background:#182234;overflow:hidden;')}>
                  <div style={ps.barStyle}></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  renderModals(v) {
    const overlay = S('position:fixed;inset:0;background:rgba(6,10,17,.66);display:flex;align-items:center;justify-content:center;z-index:50;');
    return (
      <>
        {v.showCapture && (
          <div onClick={v.closeCapture} style={S('position:fixed;inset:0;background:rgba(6,10,17,.66);display:flex;align-items:flex-start;justify-content:center;padding-top:20vh;z-index:50;')}>
            <div onClick={v.stopProp} style={S('width:520px;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div style={S('font-size:14px;font-weight:600;color:#c6d1e0;')}>💡 快速記錄</div>
              <input autoFocus value={v.captureText} onChange={v.setCaptureText} onKeyDown={v.captureKey} placeholder="腦中的想法丟進來就好，Enter 存入收集箱" style={S('background:#0c1420;border:1px solid #24334c;border-radius:10px;padding:13px 15px;color:#dfe9f6;font-size:15px;outline:none;')} />
              <div style={S('display:flex;justify-content:space-between;align-items:center;')}>
                <div style={S('font-size:12px;color:#5b6a80;')}>Esc 關閉 · 記完就回去專注</div>
                <button onClick={v.saveCapture} style={S('background:#2c4a75;border:none;color:#e3eefb;border-radius:9px;padding:8px 20px;font-size:13.5px;font-weight:600;cursor:pointer;')}>存入收集箱</button>
              </div>
            </div>
          </div>
        )}

        {v.showFinish && (
          <div style={overlay}>
            <div style={S('width:500px;max-width:92vw;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div>
                <div style={S('font-size:15px;font-weight:600;color:#dfe9f6;')}>完成任務 🎉</div>
                <div style={S('font-size:13px;color:#8fa2bd;margin-top:4px;')}>{v.currentTitle} · 花費 {v.finishElapsed}</div>
              </div>
              <div style={S('display:flex;flex-direction:column;gap:6px;')}>
                <div style={S('font-size:12.5px;font-weight:600;color:#8fa2bd;')}>做了什麼</div>
                <textarea autoFocus value={v.finishSummary} onChange={v.setFinishSummary} placeholder="一兩句話：完成了什麼、產出在哪" style={S('min-height:70px;resize:vertical;background:#0c1420;border:1px solid #24334c;border-radius:10px;padding:11px 13px;color:#dfe9f6;font-size:13.5px;line-height:1.6;outline:none;')} />
              </div>
              <div style={S('display:flex;flex-direction:column;gap:6px;')}>
                <div style={S('font-size:12.5px;font-weight:600;color:#8fa2bd;')}>需要調整的地方 <span style={S('font-weight:400;color:#5b6a80;')}>（選填）</span></div>
                <textarea value={v.finishAdjust} onChange={v.setFinishAdjust} placeholder="下次可以怎麼做更好、還有什麼要跟進" style={S('min-height:56px;resize:vertical;background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:11px 13px;color:#c6d1e0;font-size:13px;line-height:1.6;outline:none;')} />
              </div>
              <div style={S('display:flex;gap:10px;justify-content:flex-end;')}>
                <button onClick={v.cancelFinish} style={S('background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:9px;padding:8px 16px;font-size:13px;cursor:pointer;')}>取消</button>
                <button onClick={v.confirmFinish} style={S('background:#2c4a75;border:none;color:#e3eefb;border-radius:9px;padding:8px 20px;font-size:13.5px;font-weight:600;cursor:pointer;')}>✓ 完成任務</button>
              </div>
            </div>
          </div>
        )}

        {v.showProjMgr && (
          <div onClick={v.closeProjMgr} style={overlay}>
            <div onClick={v.stopProp} style={S('width:440px;max-width:92vw;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div style={S('font-size:15px;font-weight:600;color:#dfe9f6;')}>管理專案</div>
              <div style={S('display:flex;flex-direction:column;gap:8px;')}>
                {v.projMgrItems.map((pm, i) => (
                  <div key={i} style={S('display:flex;align-items:center;gap:8px;')}>
                    <span style={pm.dotStyle}></span>
                    <input value={pm.name} onChange={pm.rename} style={S('flex:1;background:#0c1420;border:1px solid #1a2333;border-radius:8px;padding:8px 11px;color:#c6d1e0;font-size:13px;outline:none;')} />
                    <span style={S('font-size:11.5px;color:#4d5b70;white-space:nowrap;')}>{pm.count} 個任務</span>
                    {pm.removable && <button onClick={pm.remove} title="移除（任務會歸到未分類）" style={S('background:none;border:none;color:#4d5b70;cursor:pointer;font-size:15px;padding:2px 6px;')}>×</button>}
                    {pm.locked && <span style={S('font-size:11px;color:#39465c;padding:2px 6px;')}>預設</span>}
                  </div>
                ))}
              </div>
              <input value={v.newProj} onChange={v.setNewProj} onKeyDown={v.newProjKey} placeholder="新增專案名稱，Enter 加入" style={S('background:#0c1420;border:1px solid #24334c;border-radius:9px;padding:10px 13px;color:#dfe9f6;font-size:13.5px;outline:none;')} />
              <div style={S('display:flex;justify-content:space-between;align-items:center;')}>
                <div style={S('font-size:11.5px;color:#5b6a80;')}>移除專案時，任務會自動歸到「未分類」</div>
                <button onClick={v.closeProjMgr} style={S('background:#2c4a75;border:none;color:#e3eefb;border-radius:9px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;')}>完成</button>
              </div>
            </div>
          </div>
        )}

        {v.showIdeaPrompt && (
          <div onClick={v.closeIdeaPrompt} style={overlay}>
            <div onClick={v.stopProp} style={S('width:620px;max-width:92vw;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div style={S('display:flex;align-items:baseline;justify-content:space-between;')}>
                <div style={S('font-size:15px;font-weight:600;color:#dfe9f6;')}>請 AI 整理成任務</div>
                <div style={S('font-size:12px;color:#5b6a80;')}>複製後貼給 AI，產出可直接開成任務</div>
              </div>
              <textarea readOnly value={v.ideaPromptText} style={S("min-height:260px;resize:vertical;background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:13px 15px;color:#b3c2d8;font-size:12.5px;line-height:1.65;font-family:'IBM Plex Mono',monospace;outline:none;")} />
              <div style={S('display:flex;gap:10px;justify-content:flex-end;')}>
                <button onClick={v.closeIdeaPrompt} style={S('background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:9px;padding:8px 16px;font-size:13px;cursor:pointer;')}>關閉</button>
                <button onClick={v.copyIdeaPrompt} style={S('background:#2c4a75;border:none;color:#e3eefb;border-radius:9px;padding:8px 20px;font-size:13.5px;font-weight:600;cursor:pointer;')}>{v.ideaCopyLabel}</button>
              </div>
            </div>
          </div>
        )}

        {v.showExport && (
          <div onClick={v.closeExport} style={overlay}>
            <div onClick={v.stopProp} style={S('width:620px;max-width:92vw;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div style={S('display:flex;align-items:baseline;justify-content:space-between;')}>
                <div style={S('font-size:15px;font-weight:600;color:#dfe9f6;')}>日報 Prompt</div>
                <div style={S('font-size:12px;color:#5b6a80;')}>貼給 AI 就能整理成日報</div>
              </div>
              <textarea readOnly value={v.exportText} style={S("min-height:300px;resize:vertical;background:#0c1420;border:1px solid #1a2333;border-radius:10px;padding:13px 15px;color:#b3c2d8;font-size:12.5px;line-height:1.65;font-family:'IBM Plex Mono',monospace;outline:none;")} />
              <div style={S('display:flex;gap:10px;justify-content:flex-end;')}>
                <button onClick={v.closeExport} style={S('background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:9px;padding:8px 16px;font-size:13px;cursor:pointer;')}>關閉</button>
                <button onClick={v.copyExport} style={S('background:#2c4a75;border:none;color:#e3eefb;border-radius:9px;padding:8px 20px;font-size:13.5px;font-weight:600;cursor:pointer;')}>{v.copyLabel}</button>
              </div>
            </div>
          </div>
        )}

        {v.showPause && (
          <div style={overlay}>
            <div style={S('width:460px;background:#131c2b;border:1px solid #24334c;border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);')}>
              <div style={S('font-size:15px;font-weight:600;color:#dfe9f6;')}>暫停計時 — 中斷原因？<span style={S('font-weight:400;font-size:12.5px;color:#5b6a80;')}>（可不填）</span></div>
              <div style={S('display:flex;flex-wrap:wrap;gap:8px;')}>
                {v.reasonItems.map((rz, i) => (
                  <button key={i} onClick={rz.pick} style={S('background:#182640;border:1px solid #24334c;color:#a9c0dd;border-radius:9px;padding:8px 16px;font-size:13.5px;cursor:pointer;')}>{rz.label}</button>
                ))}
              </div>
              <div style={S('display:flex;gap:10px;justify-content:flex-end;')}>
                <button onClick={v.closePause} style={S('background:none;border:1px solid #24334c;color:#8fa2bd;border-radius:9px;padding:8px 16px;font-size:13px;cursor:pointer;')}>取消</button>
                <button onClick={v.pauseNoReason} style={S('background:#233b5e;border:none;color:#cfe0f5;border-radius:9px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;')}>直接暫停</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  renderVals() {
    const s = this.state;
    const now = new Date(s.now);
    const elapsed = this.elapsedSec();
    const idleSec = this.idleSecVal();
    const pomoMin = POMO_MIN, breakMin = BREAK_MIN, idleMin = IDLE_MIN;
    const cur = this.cur();
    const pomoTotal = pomoMin * 60;
    const isPomodoro = s.mode === 'pomodoro';
    const remaining = Math.max(0, pomoTotal - elapsed);
    const timerText = isPomodoro ? fmtTime(remaining) : fmtTime(elapsed);
    const pomoDone = isPomodoro && s.running && remaining === 0;
    const overBreak = !isPomodoro && s.running && elapsed >= breakMin * 60;
    const chipOn = S('flex:1;white-space:nowrap;background:#233b5e;border:none;color:#d5e3f6;border-radius:7px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer;');
    const chipOff = { ...chipOn, background: 'none', color: '#6d7c92', fontWeight: 400 };
    const enter = (fn) => (e) => { if (e.key === 'Enter' && e.target.value.trim()) fn(e.target.value.trim()); };

    // ----- today stats -----
    const statsBy = byProject(s.tasks, cur ? cur.id : null, elapsed);
    const statEntries = Object.entries(statsBy).sort((a, b) => b[1] - a[1]);
    const statsTotal = statEntries.reduce((a, [, v]) => a + v, 0);
    const statMax = statEntries.length ? statEntries[0][1] : 1;

    // ----- history / analytics -----
    const today = computeToday(s.tasks, s.pauses, cur ? cur.id : null, elapsed);
    const days = [today, ...s.history];
    const dayTotalOf = (d) => Object.values(d.byProj || {}).reduce((a, b) => a + b, 0);
    const fmtDate = (str) => {
      if (str === '今天') return '今天';
      const d = new Date(str + 'T00:00:00');
      return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
    };
    const sel = days[Math.min(s.selDay, days.length - 1)];
    const analytics = computeAnalytics(days);
    const navOn = S('white-space:nowrap;background:#233b5e;border:none;color:#d5e3f6;border-radius:7px;padding:5px 14px;font-size:12.5px;font-weight:600;cursor:pointer;');
    const navOff = { ...navOn, background: 'none', color: '#6d7c92', fontWeight: 400 };

    return {
      // header / clock
      clockTime: now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      clockDate: now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }),
      onToday: s.view === 'today', onHistory: s.view === 'history',
      viewToday: () => this.setState({ view: 'today' }),
      viewHistory: () => this.setState({ view: 'history', selDay: 0 }),

      // task list
      taskCount: s.tasks.length,
      doneCount: s.tasks.filter((t) => t.done).length,
      taskItems: s.tasks.map((t) => {
        const isCur = t.id === s.currentId;
        return {
          ...t,
          timeText: t.totalSec > 0 ? fmtTime(t.totalSec) : '—',
          cardStyle: { background: isCur ? '#15233a' : '#111927', border: '1px solid ' + (isCur ? '#33507e' : '#1a2333'), borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', opacity: t.done ? .55 : 1 },
          titleStyle: { fontSize: '13.5px', fontWeight: isCur ? 600 : 500, color: isCur ? '#dfe9f6' : '#b3c2d8', textDecoration: t.done ? 'line-through' : 'none', lineHeight: 1.4 },
          checkStyle: { width: '18px', height: '18px', flex: '0 0 auto', borderRadius: '6px', border: '1.5px solid ' + (t.done ? '#4d7ec2' : '#33425c'), background: t.done ? '#2c4a75' : 'none', color: '#dfe9f6', fontSize: '11px', cursor: 'pointer', padding: 0 },
          checkMark: t.done ? '✓' : '',
          projChipStyle: { fontSize: '11px', color: this.projColor(t.project), background: '#182640', borderRadius: '5px', padding: '1px 7px', cursor: 'pointer' },
          cycleProject: (e) => {
            e.stopPropagation();
            const all = [...s.projects];
            const idx = all.indexOf(t.project);
            const next = all[(idx + 1) % all.length];
            this.setState((st) => ({ tasks: st.tasks.map((x) => x.id === t.id ? { ...x, project: next } : x) }));
          },
          select: () => {
            if (t.id === s.currentId) { this.setState({ breakDismissed: false }); return; }
            this.setState({ currentId: t.id, elapsedBase: 0, running: false, runStartMs: 0, breakDismissed: false, idleSinceMs: Date.now(), idleDismissed: false });
          },
          toggle: (e) => { e.stopPropagation(); this.setState((st) => ({ tasks: st.tasks.map((x) => x.id === t.id ? { ...x, done: !x.done } : x) })); },
        };
      }),
      newTask: s.newTask,
      setNewTask: (e) => this.setState({ newTask: e.target.value }),
      newTaskKey: enter((val) => this.setState((st) => ({ tasks: [...st.tasks, { id: Date.now(), title: val, project: st.newTaskProj, done: false, totalSec: 0, note: '', steps: [] }], newTask: '' }))),
      projChips: s.projects.map((name) => ({
        name,
        style: { background: s.newTaskProj === name ? '#233b5e' : 'none', border: '1px solid ' + (s.newTaskProj === name ? '#39537e' : '#1d2839'), color: s.newTaskProj === name ? this.projColor(name) : '#6d7c92', borderRadius: '7px', padding: '3px 10px', fontSize: '11.5px', cursor: 'pointer', whiteSpace: 'nowrap' },
        pick: () => this.setState({ newTaskProj: name }),
      })),

      // focus card
      currentTitle: cur ? cur.title : '（選一個任務開始）',
      currentProject: cur ? cur.project : '',
      statusLabel: s.running ? '專注中 · NOW' : '已暫停',
      statusDotStyle: { width: '9px', height: '9px', borderRadius: '50%', background: s.running ? '#5fd39a' : '#6d7c92', animation: s.running ? 'pulseDot 2s infinite' : 'none' },
      timerText,
      timerSubText: isPomodoro ? (pomoDone ? '番茄鐘完成！休息一下' : '番茄鐘 ' + pomoMin + ' 分鐘') : '碼表計時',
      isPomodoro,
      pomoBarStyle: { height: '100%', width: (isPomodoro ? Math.min(100, (elapsed / pomoTotal) * 100) : 0) + '%', background: '#4d7ec2', transition: 'width 1s linear' },
      modeBtnStopwatch: !isPomodoro ? chipOn : chipOff,
      modeBtnPomodoro: isPomodoro ? chipOn : chipOff,
      setModeStopwatch: () => this.setState({ mode: 'stopwatch' }),
      setModePomodoro: () => this.setState((st) => ({ mode: 'pomodoro', elapsedBase: 0, runStartMs: st.running ? Date.now() : 0 })),
      running: s.running, notRunning: !s.running,
      startTimer: () => {
        const el = this.elapsedSec();
        const reset = isPomodoro && (pomoTotal - el) <= 0;
        this.setState({ running: true, runStartMs: Date.now(), elapsedBase: reset ? 0 : el, idleDismissed: false, breakDismissed: false, idleSinceMs: Date.now() });
      },
      openPause: () => this.setState({ showPause: true }),
      closePause: () => this.setState({ showPause: false }),
      pauseNoReason: () => this.doPause(null),
      reasonItems: ['會議', '訊息回覆', '被打斷', '分心了', '休息', '換任務'].map((label) => ({ label, pick: () => this.doPause(label) })),
      finishTask: () => this.setState({ showFinish: true, finishSummary: '', finishAdjust: '' }),
      finishElapsed: fmtTime((cur ? cur.totalSec : 0) + elapsed),
      finishSummary: s.finishSummary,
      finishAdjust: s.finishAdjust,
      setFinishSummary: (e) => this.setState({ finishSummary: e.target.value }),
      setFinishAdjust: (e) => this.setState({ finishAdjust: e.target.value }),
      cancelFinish: () => this.setState({ showFinish: false }),
      confirmFinish: () => {
        const el = this.elapsedSec();
        this.updateCur((t) => ({ done: true, totalSec: t.totalSec + el, summary: s.finishSummary.trim(), adjust: s.finishAdjust.trim() }));
        this.setState({ running: false, runStartMs: 0, elapsedBase: 0, showFinish: false, idleSinceMs: Date.now() });
      },
      todayTotal: fmtTime((cur ? cur.totalSec : 0) + elapsed),
      elapsedMin: Math.floor(elapsed / 60),
      idleMin: Math.floor(idleSec / 60),
      showBreakReminder: (overBreak || pomoDone) && !s.breakDismissed,
      dismissBreak: () => { if (pomoDone) this.setState({ breakDismissed: true, running: false, runStartMs: 0, elapsedBase: 0, idleSinceMs: Date.now() }); else this.setState({ breakDismissed: true }); },
      showIdleReminder: !s.running && idleSec >= idleMin * 60 && !s.idleDismissed && !!cur && !cur.done,
      dismissIdle: () => this.setState({ idleDismissed: true }),

      // steps
      nextStep: s.nextStep,
      setNextStep: (e) => this.setState({ nextStep: e.target.value }),
      nextStepKey: enter((val) => { this.updateCur((t) => ({ steps: [{ text: val, time: nowHM() }, ...t.steps] })); this.setState({ nextStep: '' }); }),
      stepItems: (cur ? cur.steps : []).map((st2, i) => ({ ...st2, remove: () => this.updateCur((t) => ({ steps: t.steps.filter((_, j) => j !== i) })) })),

      // pauses (today)
      noPauses: s.pauses.length === 0,
      pauseItems: s.pauses,

      // ideas
      noIdeas: s.ideas.length === 0,
      ideaItems: s.ideas.map((idea, i) => ({
        ...idea,
        aiPrompt: () => this.setState({ ideaPromptFor: idea.text, ideaCopied: false }),
        promote: () => this.setState((st) => ({ tasks: [...st.tasks, { id: Date.now(), title: idea.text, project: '來自 Idea', done: false, totalSec: 0, note: '', steps: [] }], ideas: st.ideas.filter((_, j) => j !== i) })),
        remove: () => this.setState((st) => ({ ideas: st.ideas.filter((_, j) => j !== i) })),
      })),

      // notes / replies
      tabNotes: () => this.setState({ tab: 'notes' }),
      tabReplies: () => this.setState({ tab: 'replies' }),
      onNotesTab: s.tab === 'notes', onRepliesTab: s.tab === 'replies',
      tabNotesStyle: s.tab === 'notes' ? chipOn : chipOff,
      tabRepliesStyle: s.tab === 'replies' ? chipOn : chipOff,
      globalNote: s.globalNote,
      setGlobalNote: (e) => this.setState({ globalNote: e.target.value }),
      newReply: s.newReply,
      setNewReply: (e) => this.setState({ newReply: e.target.value }),
      newReplyKey: enter((val) => this.setState((st) => ({ replies: [...st.replies, { text: val, done: false }], newReply: '' }))),
      replyItems: s.replies.map((r, i) => ({
        ...r,
        checkMark: r.done ? '✓' : '',
        checkStyle: { width: '17px', height: '17px', flex: '0 0 auto', borderRadius: '6px', border: '1.5px solid ' + (r.done ? '#4d7ec2' : '#33425c'), background: r.done ? '#2c4a75' : 'none', color: '#dfe9f6', fontSize: '10px', cursor: 'pointer', padding: 0 },
        textStyle: { color: r.done ? '#5b6a80' : '#b3c2d8', textDecoration: r.done ? 'line-through' : 'none' },
        toggle: () => this.setState((st) => ({ replies: st.replies.map((x, j) => j === i ? { ...x, done: !x.done } : x) })),
      })),
      taskNote: cur ? cur.note : '',
      setTaskNote: (e) => this.updateCur({ note: e.target.value }),

      // quick capture
      showCapture: s.showCapture,
      openCapture: () => this.setState({ showCapture: true, captureText: '' }),
      closeCapture: () => this.setState({ showCapture: false }),
      stopProp: (e) => e.stopPropagation(),
      captureText: s.captureText,
      setCaptureText: (e) => this.setState({ captureText: e.target.value }),
      captureKey: (e) => { if (e.key === 'Enter' && s.captureText.trim()) this.setState((st) => ({ ideas: [{ text: st.captureText.trim(), time: nowHM() }, ...st.ideas], captureText: '', showCapture: false })); },
      saveCapture: () => { if (s.captureText.trim()) this.setState((st) => ({ ideas: [{ text: st.captureText.trim(), time: nowHM() }, ...st.ideas], captureText: '', showCapture: false })); },

      // pause modal
      showPause: s.showPause,

      // finish modal
      showFinish: s.showFinish,

      // project manager
      showProjMgr: s.showProjMgr,
      openProjMgr: () => this.setState({ showProjMgr: true }),
      closeProjMgr: () => this.setState({ showProjMgr: false }),
      newProj: s.newProj,
      setNewProj: (e) => this.setState({ newProj: e.target.value }),
      newProjKey: enter((val) => this.setState((st) => st.projects.includes(val) ? { newProj: '' } : { projects: [...st.projects, val], newProj: '', newTaskProj: val })),
      projMgrItems: s.projects.map((name) => ({
        name,
        count: s.tasks.filter((t) => t.project === name).length,
        removable: name !== '未分類',
        locked: name === '未分類',
        dotStyle: { width: '9px', height: '9px', flex: '0 0 auto', borderRadius: '50%', background: this.projColor(name) },
        rename: (e) => { const val = e.target.value; if (val.trim()) this.renameProj(name, val); },
        remove: () => this.setState((st) => ({
          projects: st.projects.filter((p) => p !== name),
          tasks: st.tasks.map((t) => t.project === name ? { ...t, project: '未分類' } : t),
          newTaskProj: st.newTaskProj === name ? '未分類' : st.newTaskProj,
        })),
      })),

      // idea → AI prompt modal
      showIdeaPrompt: !!s.ideaPromptFor,
      ideaPromptText: s.ideaPromptFor ? buildIdeaPrompt(s.ideaPromptFor) : '',
      closeIdeaPrompt: () => this.setState({ ideaPromptFor: null }),
      ideaCopyLabel: s.ideaCopied ? '✓ 已複製' : '複製 Prompt',
      copyIdeaPrompt: () => { navigator.clipboard.writeText(buildIdeaPrompt(s.ideaPromptFor)).then(() => this.setState({ ideaCopied: true })).catch(() => {}); },

      // today stats bars
      statsTotal: fmtTime(statsTotal),
      pauseCount: s.pauses.length,
      ideaCount: s.ideas.length,
      statItems: statEntries.map(([name, sec]) => ({
        name, timeText: fmtTime(sec),
        barStyle: { height: '100%', width: Math.max(4, (sec / statMax) * 100) + '%', background: this.projColor(name), opacity: .75, transition: 'width 1s linear' },
      })),

      // export modal
      showExport: s.showExport,
      exportText: s.showExport ? buildExport({ tasks: s.tasks, pauses: s.pauses, ideas: s.ideas, globalNote: s.globalNote, currentId: cur ? cur.id : null, elapsed, now }) : '',
      openExport: () => this.setState({ showExport: true, copied: false }),
      closeExport: () => this.setState({ showExport: false }),
      copyLabel: s.copied ? '✓ 已複製' : '複製 Prompt',
      copyExport: () => { navigator.clipboard.writeText(buildExport({ tasks: s.tasks, pauses: s.pauses, ideas: s.ideas, globalNote: s.globalNote, currentId: cur ? cur.id : null, elapsed, now })).then(() => this.setState({ copied: true })).catch(() => {}); },

      // history view
      viewTodayStyle: navOn, viewHistoryStyle: navOff,
      dayItems: days.map((d, i) => ({
        dateText: fmtDate(d.date), totalText: fmtTime(dayTotalOf(d)), done: d.done, interrupts: d.pauses.length,
        cardStyle: { background: i === s.selDay ? '#15233a' : '#111927', border: '1px solid ' + (i === s.selDay ? '#33507e' : '#1a2333'), borderRadius: '12px', padding: '12px 14px', cursor: 'pointer' },
        dateStyle: { fontSize: '13.5px', fontWeight: i === s.selDay ? 600 : 500, color: i === s.selDay ? '#dfe9f6' : '#b3c2d8' },
        select: () => this.setState({ selDay: i }),
      })),
      selDayTitle: sel.date === '今天' ? '今天' : new Date(sel.date + 'T00:00:00').toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }),
      selDayTotal: fmtTime(dayTotalOf(sel)),
      selDayTasks: sel.tasks.map((t) => ({
        title: t.title, project: t.project,
        timeText: t.totalSec > 0 ? fmtTime(t.totalSec) : '未計時',
        dotStyle: { width: '7px', height: '7px', flex: '0 0 auto', borderRadius: '50%', background: t.done ? '#5fd39a' : '#6d7c92' },
      })),
      selDayNoPauses: sel.pauses.length === 0,
      selDayPauses: sel.pauses,
      avgDaily: fmtTime(analytics.avgSec),
      trendItems: analytics.trend.map(({ day: d, total: t2 }) => ({
        label: d.date === '今天' ? '今天' : fmtDate(d.date).split('（')[0],
        hours: (t2 / 3600).toFixed(1),
        barStyle: { width: '100%', maxWidth: '26px', height: Math.max(4, (t2 / analytics.maxDay) * 70) + 'px', borderRadius: '4px 4px 0 0', background: d.date === '今天' ? '#4d7ec2' : '#2c4a75', opacity: .85 },
      })),
      reasonStats: analytics.reasonStats.map((rs) => ({
        reason: rs.reason, count: rs.count,
        barStyle: { height: '100%', width: Math.max(6, rs.ratio * 100) + '%', background: '#8a9fc0', opacity: .7 },
      })),
      insightText: analytics.insight,
      projStats: analytics.projStats.map((ps) => ({
        name: ps.name, timeText: fmtTime(ps.sec),
        barStyle: { height: '100%', width: Math.max(4, ps.ratio * 100) + '%', background: this.projColor(ps.name), opacity: .75 },
      })),
    };
  }
}
