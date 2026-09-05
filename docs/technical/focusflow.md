# FocusFlow 技術文件

## 架構

本機單人應用，保留 Vite + React 與 JSON 檔案架構，沒有加入雲端儲存、帳號或新依賴。

| 檔案 | 職責 |
|---|---|
| `src/App.jsx` | React 介面、原生 dialog、鍵盤操作、提醒呈現與瀏覽器通知 |
| `src/styles.css` | 共用設計 token、夜色／日光、響應式配置、減少動態效果 |
| `src/model.js` | 資料升級、計時狀態轉換、跨日、分心提醒、時間預算 |
| `src/logic.js` | 日期格式、每日快照、統計與文字匯出 |
| `src/api.js` | 載入與依序自動儲存、失敗重試與狀態回報 |
| `src/seed.js` | 首次啟動空白資料 |
| `vite.config.js` | dev／preview 的本機 `/api/data` 與原子替換檔案 |

## 資料相容性

沿用 `rev`、`activeDate`、`projects`、`tasks`、`ideas`、`replies`、`pauses`、`history`、`globalNote` 等欄位。

新增：

- `tasks[].estimateMin`：預估分鐘，舊任務預設 25。
- `settings`：專注分鐘、休息分鐘、每日可用分鐘、主題、專注時安靜、桌面通知開關。
- `timer`：`phase`、`running`、`startedAt`、`elapsed`、`duration`、`hasStarted`。
- `ideas[]`：穩定 ID、建立時間、`reminder`（none／break／time）、`remindAt`、`readyAt`、`notifiedAt`、`done`。
- `lastTimerEvent`：最近一次計時結束事件，避免同一段重複發出桌面通知。

`normalizeData` 保留既有資料並補齊欄位；舊 `elapsed` 移入 timer，舊靈感預設不提醒，不捏造建立日期。舊版雙重 JSON 編碼在讀取時解開；下次正常儲存即改成物件。

## 計時

介面每秒更新一次顯示，不會每秒寫入檔案。開始時儲存牆鐘時間 `startedAt`，顯示以 `Date.now()` 差值計算，支援分頁節流和重新載入。

`transition` 是修改計時的單一入口：

- start：啟動／恢復未完成任務。
- pause：立即凍結 elapsed，原因可之後補上。
- select／mode／complete：先結算現有焦點的工時，再轉換狀態。
- break：結算專注工時，啟動獨立休息計時。
- tick：僅在到期或跨日時產生新資料；番茄鐘到期恰好結算一次。

`tasks[].totalSec` 只包含已結算工時。`liveFocusSeconds` 只對目前 focus 段提供未結算工時；break、focusDone、breakDone 均不增加任務工時。

番茄鐘及休息以 duration 為上限；碼表無上限。碼表在離開頁面或休眠後仍按牆鐘累計，使用者離開工作前應暫停。

`advanceTime` 在 local midnight 分割工時，再呼叫 `applyRollover` 歸檔。未完成任務連同筆記、步驟與預估帶到次日，已結算日工時歸零；歷史保存完整任務快照，最多 90 日。午夜前已結束的番茄鐘不會把休眠期間算入次日工時。

## 提醒

快速記錄不修改 timer。break 提醒在下一個暫停／休息邊界設定 `readyAt`；time 提醒以 `remindAt` 判斷是否到期。完成或取消提醒會從待提醒清單移除，延後會重設通知標記。

「專注時安靜」啟用時，focus running 不發桌面通知，畫面只呈現待提醒數量；離開專注時彙整為一則無聲通知。Notification 權限只在使用者按下設定按鈕時請求。

沒有 Service Worker、背景推播服務或作業系統排程。頁面關閉、裝置休眠、背景節流時不能保證即時送達，重開後用持久化時間重新計算到期事項。

## 儲存與本機 API

GET `/api/data` 讀取；PUT／POST 寫入。Vite dev 與 preview 共用同一 middleware。

- 讀取成功後才允許編輯與存檔。
- 正常 debounce 500ms，持續編輯最長約 2 秒啟動一次保存。
- 同一客戶端寫入依序執行，進行中的請求完成後才傳較新快照。
- 一般儲存失敗保留最新 pending snapshot，顯示 error，手動或 reconnect 重試。
- 409 表示資料世代已重置，停止所有後續寫入。
- visibilitychange／beforeunload 會 flush。小於 60KB 的內容使用 fetch keepalive；尚未確認寫入時註冊離開提示，大筆資料應等到「已儲存」再關閉。
- 伺服器拒絕非物件或缺少 tasks 陣列的寫入，保留既有世代檢查。
- 先寫同目錄暫存檔再 rename，避免截斷正式檔案。

`rev` 僅防止資料重置後舊分頁寫回，不是多分頁的版本衝突合併。仍建議單一分頁使用。直接部署 `dist/` 到靜態主機無法提供此 Node 檔案 API。

## 驗證

```bash
npm test
npm run build
```

測試涵蓋：任務／模式切換結算、暫停與休息排除、番茄鐘節流與冪等結算、刷新恢復、午夜分割、提醒釋放／延後／取消／轉任務、舊資料相容、時間預算、儲存排序／失敗重試／世代拒絕。

介面採原生 form、button、input 與 modal dialog，包含 Escape、焦點返回、中文輸入法 Enter 防誤送、鍵盤快捷鍵與 reduced-motion CSS。瀏覽器視覺和互動驗證仍需在實際桌面／手機環境執行。
