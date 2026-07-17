// Default data written to data/focusflow.json on first run.
// Mirrors the design mockup's initial state so a fresh install looks alive.
// Returns a fresh deep copy each call so callers can freely mutate it.
export function defaultData() {
  return {
    activeDate: null, // set to todayKey() by the server when the seed is written
    projects: ['產品規劃', '設計協作', '用戶研究', '未分類'],
    newTaskProj: '未分類',
    currentId: 1,
    mode: 'stopwatch',
    elapsed: 0,
    tab: 'notes',
    globalNote: '',
    tasks: [
      { id: 1, title: '完成 Q3 產品規格初稿', project: '產品規劃', done: false, totalSec: 3720, note: '', steps: [{ text: '先確認 API 欄位再寫第三節', time: '10:24' }] },
      { id: 2, title: '回覆設計團隊的元件命名建議', project: '設計協作', done: false, totalSec: 0, note: '', steps: [] },
      { id: 3, title: '整理上週用戶訪談重點', project: '用戶研究', done: true, totalSec: 2700, note: '', steps: [] },
    ],
    ideas: [{ text: '任務完成時可以加一個小小的慶祝動畫', time: '09:41' }],
    replies: [{ text: '回 Alex：週四 demo 時間確認', done: false }],
    pauses: [],
    history: [
      {
        date: '2026-07-17', done: 3, byProj: { '產品規劃': 9840, '設計協作': 4500, '用戶研究': 2700 },
        tasks: [
          { title: '完成 Q3 產品規格初稿', project: '產品規劃', done: false, totalSec: 6300 },
          { title: '規格審查會議準備', project: '產品規劃', done: true, totalSec: 3540 },
          { title: '元件命名規範討論', project: '設計協作', done: true, totalSec: 4500 },
          { title: '整理上週用戶訪談重點', project: '用戶研究', done: true, totalSec: 2700 },
        ],
        pauses: [
          { time: '10:12', reason: '訊息回覆', task: '完成 Q3 產品規格初稿' },
          { time: '11:40', reason: '會議', task: '完成 Q3 產品規格初稿' },
          { time: '15:05', reason: '分心了', task: '元件命名規範討論' },
        ],
      },
      {
        date: '2026-07-16', done: 4, byProj: { '產品規劃': 7200, '用戶研究': 8100 },
        tasks: [
          { title: '用戶訪談 ×2', project: '用戶研究', done: true, totalSec: 5400 },
          { title: '訪談逐字稿標記', project: '用戶研究', done: true, totalSec: 2700 },
          { title: 'Q3 規格大綱', project: '產品規劃', done: true, totalSec: 4800 },
          { title: '需求優先級排序', project: '產品規劃', done: true, totalSec: 2400 },
        ],
        pauses: [
          { time: '09:50', reason: '訊息回覆', task: 'Q3 規格大綱' },
          { time: '14:20', reason: '訊息回覆', task: '用戶訪談 ×2' },
        ],
      },
      {
        date: '2026-07-15', done: 2, byProj: { '設計協作': 10800, '未分類': 1800 },
        tasks: [
          { title: 'Design review + 修訂', project: '設計協作', done: true, totalSec: 7200 },
          { title: '元件庫盤點', project: '設計協作', done: true, totalSec: 3600 },
          { title: '信箱清理', project: '未分類', done: false, totalSec: 1800 },
        ],
        pauses: [
          { time: '10:30', reason: '會議', task: 'Design review + 修訂' },
          { time: '13:15', reason: '分心了', task: '元件庫盤點' },
          { time: '16:00', reason: '被打斷', task: '元件庫盤點' },
          { time: '16:40', reason: '分心了', task: '信箱清理' },
        ],
      },
      {
        date: '2026-07-14', done: 3, byProj: { '產品規劃': 5400, '設計協作': 3600, '用戶研究': 3600 },
        tasks: [
          { title: '週會 + 週報', project: '未分類', done: true, totalSec: 0 },
          { title: '競品分析更新', project: '產品規劃', done: true, totalSec: 5400 },
          { title: '設計走查', project: '設計協作', done: true, totalSec: 3600 },
          { title: '訪談題綱草稿', project: '用戶研究', done: false, totalSec: 3600 },
        ],
        pauses: [{ time: '11:00', reason: '會議', task: '競品分析更新' }],
      },
      {
        date: '2026-07-13', done: 1, byProj: { '產品規劃': 4500 },
        tasks: [{ title: '路線圖初稿', project: '產品規劃', done: true, totalSec: 4500 }],
        pauses: [
          { time: '10:10', reason: '訊息回覆', task: '路線圖初稿' },
          { time: '11:30', reason: '分心了', task: '路線圖初稿' },
          { time: '14:00', reason: '訊息回覆', task: '路線圖初稿' },
        ],
      },
    ],
  };
}
