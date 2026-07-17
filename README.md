# FocusFlow

解放大腦記憶空間的 ADHD 工作任務管理器。單人、本機、無雲端、無登入。
所有資料存成一份好讀、可備份的 JSON 檔（`data/focusflow.json`）。

## 快速開始

```bash
npm install
npm run dev
```

打開終端機顯示的網址（預設 http://localhost:5173）就能使用。

## 資料存哪裡

- 全部資料存在 `data/focusflow.json`（純文字 JSON，可直接備份、版本控制或手動編輯）。
- 第一次啟動會自動用預設範例資料建立這個檔。
- 前端載入時讀一次，之後任何變更會在 ~500ms 後自動存回；切換分頁／關閉頁面時也會盡量即時寫入。
- 想清空重來：關掉頁面、刪掉 `data/focusflow.json`，重新整理即可重建預設資料。

## 功能

- **今天**：任務清單（專案篩選／管理、完成勾選、切換當前任務、累積工時）、專注區（番茄鐘 25 分／碼表、開始／暫停／完成、暫停原因記錄、下一步捕捉、休息與閒置提醒）、Idea 收集箱（快速記錄、開成任務、產生 AI 整理 prompt）、筆記／待回覆、匯出日報 prompt。
- **歷史與分析**：每日紀錄、當日明細、7 日專注趨勢、中斷原因分析、各專案工時、自動洞察句。

## 技術

- Vite + React（純 JSX），僅依賴 react / react-dom / vite / @vitejs/plugin-react / vitest。
- 持久化：`vite.config.js` 內一個小型 plugin 用 `configureServer` 掛載 `/api/data`（GET 讀、PUT/POST 寫），以 Node `fs` 讀寫 `data/focusflow.json`。
- 純邏輯（日期鍵、時間格式、彙整、匯出、跨日歸檔）集中在 `src/logic.js`，有單元測試。

## 測試

```bash
npx vitest run
```
