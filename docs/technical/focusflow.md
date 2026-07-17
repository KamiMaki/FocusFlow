# FocusFlow 技術文件

## 這次改了什麼

本版本交付 FocusFlow v1.0.0，核心功能完整實現。

### 文件清單

| 文件 | 說明 |
|---|---|
| `src/App.jsx` | React 主元件（單一 Class Component），包含全部 UI 邏輯、狀態管理、計時、模態框 |
| `src/logic.js` | 純邏輯層（19 個單元測試覆蓋）：日期、時間格式、任務聚合、分析計算、匯出生成 |
| `src/logic.test.js` | Vitest 測試套件（19 個測試全綠）|
| `src/api.js` | HTTP 客户端：GET/PUT `/api/data`、防抖自動存檔 |
| `src/seed.js` | 預設資料：包含範例任務、Idea、歷史紀錄（預填工作流範例） |
| `src/main.jsx` | React 入口 |
| `vite.config.js` | Vite 設定 + 自訂持久化 plugin |
| `package.json` | 依賴版本清單、npm 指令 |
| `docs/` | 文件目錄（本檔、使用指南、變更日誌） |

### 功能模組

- **任務管理**：建立、編輯、完成、按專案分類
- **計時系統**：碼表（自由計時）/ 番茄鐘（25 分鐘）
- **中斷記錄**：可選原因、自動統計
- **Idea 收集**：快速記錄、轉任務、AI prompt 生成
- **筆記系統**：全域筆記、待回覆、任務專屬筆記
- **歷史與分析**：7 日統計、趨勢圖、原因分析、專案工時排名
- **資料持久化**：本機 JSON 檔、自動防抖存檔、頁面卸載即時寫入

## 為什麼這樣做

### 架構選擇

**單一 Class Component**
- FocusFlow 是高交互、狀態複雜的單頁應用
- 用 React Class Component + setState 承載 ~20 個不同的 UI 狀態（timer、modal、tab、form）
- 避免 Hooks 複雜度過高，改用單一真實來源（state 物件）

**純邏輯層分離（logic.js）**
- 所有計算（日期、時間、聚合、匯出）都獨立成純函式，零副作用
- 支持完整單元測試（不需要 React 或 DOM）
- 邏輯層可重複使用，例如後續若要做 CLI 或 Electron 版本

**本機 JSON 持久化**
- 無雲端、無登入、完全私密（資料在本機磁碟）
- JSON 人類可讀，支持手動編輯或版本控制
- 避免 IndexedDB / LocalStorage 的同源限制，支持 Vite dev server 和 production build

**防抖自動存檔**
- 實時儲存：每次狀態變更後 500ms 自動 PUT /api/data
- 卸載即時存：beforeunload / visibilitychange 事件觸發立即 flush
- 利用 navigator.sendBeacon 確保關頁面時資料能送出

**一個日期基準（todayKey）**
- 統一用本機 `YYYY-MM-DD` 格式作為「今天」的唯一來源
- 避免 UTC vs 本機時區的混淆（特別是跨午夜時差造成的 bug）
- 所有時間戳（HH:MM）也都是本機時間

### 設計決策

**計時器用 Date.now() 而非 setInterval**
- setInterval 會被瀏覽器節流（低優先度分頁 ≤ 1Hz）
- Date.now() delta 方式即使分頁被節流也能準確計時
- 頁面每秒更新一次 UI（用 setInterval 觸發 setState）

**暫停原因預設清單**
- 預設了 6 個高頻中斷原因（會議、訊息回覆、被打斷、分心、休息、換任務）
- 可選填，按暫停時選擇，累積 7 日統計
- 支援自行輸入其他原因

**番茄鐘 25 分 + 休息 50 分 + 閒置提醒 5 分**
- 25 分是經典番茄鐘時段
- 50 分是「兩個番茄鐘間的最小休息」（POMO_MIN × 2 + buffer）
- 5 分是「多久沒計時」的閒置提醒閾值

**日期翻天時自動歸檔**
- 頁面載入時檢查 activeDate vs todayKey()
- 若發現日期改變，用 applyRollover() 把前一天任務狀態快照存入 history
- 之後的任務清單自動重置，讓每天都是「乾淨的」狀態

**Idea 可轉任務或生成 AI Prompt**
- 「轉任務」：快速把靈感拉進任務列表（自動歸到「來自 Idea」專案）
- 「AI 整理」：生成一份 prompt，複製貼給 AI（ChatGPT 等）讓它分解成可執行子任務

## 怎麼運作的

### 核心模組關係

```
┌─ App.jsx (React 主元件)
│  ├─ state: { tasks, pauses, ideas, projects, mode, tab, elapsed, ... }
│  ├─ elapsedSec() → 當前計時秒數（根據 Date.now() 計算）
│  ├─ updateCur() → 修改當前任務
│  ├─ doPause() → 記錄一個暫停
│  ├─ serialize() → 序列化可持久化欄位
│  └─ renderVals() → 計算所有 UI 衍生值
│
├─ logic.js (純邏輯層)
│  ├─ todayKey(d) → 本機 YYYY-MM-DD
│  ├─ fmtTime(sec) → mm:ss or h:mm:ss
│  ├─ nowHM(d) → HH:MM
│  ├─ byProject(tasks, curId, elapsed) → { 專案名: 秒數 }
│  ├─ computeToday(...) → 今日快照
│  ├─ computeAnalytics(days) → 7 日統計
│  ├─ buildExport(...) → 日報 prompt 文字
│  ├─ buildIdeaPrompt(ideaText) → AI 整理 prompt
│  └─ applyRollover(raw, today) → 日期翻天時歸檔前一天
│
├─ api.js (HTTP 層)
│  ├─ loadData() → GET /api/data（頁面載入時一次）
│  ├─ put(data) → PUT /api/data（存檔時用）
│  └─ createSaver(delay) → 防抖器（500ms 防抖 + flush 機制）
│
├─ seed.js (預設資料)
│  └─ defaultData() → 首次啟動的範例資料
│
└─ vite.config.js (持久化 plugin)
   ├─ dataApiPlugin() → 攔截 /api/data
   │  ├─ GET /api/data → 讀 data/focusflow.json，首次不存在時建立
   │  └─ PUT /api/data → 寫 data/focusflow.json（解析驗證後）
   └─ ensureSeed() → 確保 data/ 目錄與檔案存在
```

### 數據流

#### 啟動流程
1. 頁面載入 → App.componentDidMount()
2. loadData() GET /api/data
3. vite plugin ensureSeed() → 若 data/focusflow.json 不存在則建立預設資料
4. applyRollover() 檢查日期，若翻天則歸檔前一天
5. setState({ loaded: true, ... }) 載入資料到 state
6. setInterval 每秒更新 now，觸發 setState → 計時器 UI 刷新

#### 工作期間
- 用戶操作（新增任務、開始計時、暫停等）→ setState()
- componentDidUpdate() 檢查 serialize() 有無變更
- 若變更則排隊到 saver（防抖 500ms）
- 同時 UI 讀 renderVals() 派生值重新渲染

#### 頁面卸載
- beforeunload 事件 → saver.flush()
- visibilitychange 事件（切分頁）→ saver.flush()
- flush() 優先用 sendBeacon（unload 時可靠投遞）
- 若 sendBeacon 失敗則回退 fetch

### 計時機制

**進行中的任務計時**
```javascript
elapsedSec() {
  if (state.running && state.runStartMs) {
    return state.elapsedBase + (Date.now() - state.runStartMs) / 1000;
  }
  return state.elapsedBase;
}
```
- state.elapsedBase: 累計秒數（已暫停的部分，存檔用）
- state.runStartMs: 最後一次按開始的時刻
- 即時計時 = 累計 + 本次執行時長

**當前任務的 UI 時間**
- renderVals() 中 `todayTotal: fmtTime((cur?.totalSec || 0) + elapsed)`
- 把任務的歷史累積 (totalSec) + 本次未存檔的計時 (elapsed) 加起來

### 儲存機制

**防抖邏輯**
```javascript
createSaver(500) {
  schedule(data) {
    // 1. 把最新 data 暫存
    // 2. 清之前的 timer
    // 3. 新建 timer，延遲 500ms
    // → 如果 500ms 內又呼叫 schedule，timer 重設
  }
  flush() {
    // 1. 立即取消 timer
    // 2. 用 sendBeacon 或 PUT 立即投遞
  }
}
```
- 快速操作（打字、點擊）時只排隊一次
- 卸載時強制 flush 立即投遞

**資料格式**
```json
{
  "activeDate": "2026-07-18",
  "projects": ["產品規劃", "設計協作", ...],
  "tasks": [
    {
      "id": 1,
      "title": "...",
      "project": "...",
      "done": false,
      "totalSec": 3720,
      "note": "...",
      "steps": [{"text": "...", "time": "HH:MM"}],
      "summary": "...",
      "adjust": "..."
    }
  ],
  "pauses": [{"time": "HH:MM", "reason": "...", "task": "..."}],
  "ideas": [{"text": "...", "time": "HH:MM"}],
  "replies": [{"text": "...", "done": false}],
  "history": [
    {
      "date": "2026-07-17",
      "done": 3,
      "byProj": {"專案名": 秒數, ...},
      "tasks": [...],
      "pauses": [...]
    }
  ]
}
```

### 分析計算

**7 日聚合**
```javascript
computeAnalytics(days) {
  // days 最多取前 7 個（包括今天）
  // 計算：
  // - 每日的柱狀圖高度（maxDay 基準）
  // - 每個中斷原因的頻率（maxReason 基準）
  // - 每個專案的累積秒數（maxProj 基準）
  // - 日均秒數
  // - 自動洞察句（例如「最常見的中斷是訊息回覆（14 次）…」）
}
```

**自動洞察句例子**
```
「最常見的中斷是訊息回覆（14 次）。建議專注時段改設勿擾；
週一專注度最高（8:30），試著在那個時間段排重要工作。」
```

## 怎麼使用

### 安裝與開發

```bash
# 安裝依賴
npm install

# 開發模式（Vite HMR + dev server）
npm run dev
# 打開 http://localhost:5173

# 執行測試
npm test
# 或看檔案變化時自動重跑：
npm run test -- --watch

# 構建生產版本
npm run build
# 輸出到 dist/，可用 npm run preview 預覽
```

### 修改任務狀態的例子

```javascript
// 新增任務
this.setState((st) => ({
  tasks: [...st.tasks, {
    id: Date.now(),
    title: '新任務',
    project: st.newTaskProj,
    done: false,
    totalSec: 0,
    note: '',
    steps: []
  }],
  newTask: ''
}));

// 完成當前任務
this.updateCur((t) => ({
  done: true,
  totalSec: t.totalSec + this.elapsedSec(),
  summary: userInput
}));

// 記錄一個中斷
this.setState((s) => ({
  pauses: [{
    time: nowHM(),
    reason: selectedReason,
    task: cur?.title || ''
  }, ...s.pauses]
}));
```

### 新增功能時的步驟

1. **更新 state 型別和初始值**（App.jsx 的 this.state）
2. **寫邏輯測試**（logic.test.js）若涉及計算
3. **實作邏輯函式**（logic.js）或 UI 處理
4. **在 renderVals() 中計算 UI 衍生值**
5. **新增 JSX 元件**（App.jsx 的 render 方法）
6. **新增持久化欄位**（PERSIST_KEYS 陣列）
7. **執行 `npm test` 確保測試全綠**
8. **用 `npm run dev` 手動測試 UI 行為**

## 注意事項

### 已知限制

- **單一分頁寫入**：同時在多個瀏覽器分頁編輯同一個 FocusFlow 頁面會有資料衝突。設計上只支援單一分頁使用。
- **計時暫停（硬重載後）**：用 F5 或 Ctrl+R 硬重載頁面會中斷計時（計時器的 runStartMs 會重設）。用戶需要手動重新按「開始專注」。
- **日期翻天觸發於載入時**：applyRollover() 只在頁面載入（App.componentDidMount）時執行，不會在背景主動檢查日期變更。若頁面一整天都沒刷新，前一天的資料會混在今天的 state 裡，直到下次刷新才歸檔。
- **本機限制**：無跨裝置同步、無帳號備份。資料完全私密但也完全本機。

### 效能考量

- **State 大小**：tasks 陣列每個元素最多 ~100 bytes，即使 10000 個任務也只有 ~1 MB state，不會造成 React 瓶頸。
- **計時 UI 更新**：每秒一次 setState 刷新時間顯示，用 renderVals() 的衍生值避免重複計算。
- **防抖延遲**：500ms 防抖平衡了卸載時的即時投遞和快速操作時的流暢感。
- **7 日上限**：分析只保留最近 7 天的快照，確保 O(1) 計算複雜度。

### 文件格式穩定性

- **JSON 版本控制**：data/focusflow.json 沒有明確版本號，改 schema 時要在 App.jsx 的 loadData() 後面加轉換邏輯（e.g. 缺少新欄位時補預設值）。
- **向後相容**：新增欄位時用 `|| 預設值` 確保舊資料能載入。
- **備份建議**：用 git 版本控制或定期手動複製 data/focusflow.json。

### 擴展方向

- **Electron / Desktop App**：邏輯層已獨立，可移植到 Electron 搭配真實 fs module。
- **CLI 工具**：logic.js 可直接給 Node.js 用（e.g. `node -e "import('./src/logic.js')"` 跑分析）。
- **雲同步**：在 api.js 替換 fetch 端點（例如連到 Supabase / Firebase），可加入帳號 + 跨裝置同步。
- **更多計時模式**：改 POMO_MIN / BREAK_MIN 常數或動態設定即可支援不同的番茄鐘配置。

### 開發建議

- **測試先行**：修改 logic.js 前先在 logic.test.js 寫新測試，確保邏輯正確。
- **UI 與邏輯分離**：任何計算都放 logic.js，UI 只負責展示和事件轉發。
- **狀態追蹤**：用瀏覽器 React DevTools 監看 state 變化，或在 App.jsx 的 setState callback 加 console.log。
- **檔案監視**：開發時用 `npm run dev`，修改檔案會自動 HMR，不需要手動刷新。
