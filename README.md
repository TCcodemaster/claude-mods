# Claude Code mods

四個 Claude Code mod（function hooks 外掛），在 Claude Code 自己的介面裡運作。

| mod | 功能 | 指令 |
|---|---|---|
| flowmap | 長回應結束後由 Haiku 判斷是否值得畫圖，值得就由主模型產生 Mermaid 圖，顯示在 cmux 瀏覽器窗格；預設不顯示，輸入框上方左側出現精簡的「看圖解 · 不用」按鈕（VS Code 擴充套件改用通知），按了才打開；env-hint 的環境資訊照樣留在同一行右側；圖解頁面可以編輯 Mermaid 語法重畫，並匯出 SVG、PNG、Mermaid 原始碼 | `/flow`、`/flow hide`、`/flow on\|off`、`/flow web on\|off` |
| gitgraph | 仿 GitHub Desktop 的提交列表，可同時勾選多條分支比對 | `/branches`、`/branches 分支 分支`、`/branches all`、`/branches hide` |
| env-hint | 在輸入框上方靠右顯示「機器 / 資料夾 / 分支」，依序為藍色粗體、綠、紫色，後面用鉛筆 icon 標未提交的檔案數、向上箭頭 icon 標未推送的提交數（0 就不顯示；終端機改用文字）；不在 git 目錄時只顯示機器與資料夾。開對話、送出訊息與回應結束時更新；flowmap 的「看圖解」按鈕排在同一行左側 | 無 |
| ledger-hint | 把 Ledger 自動同步的消息改成提醒小框：推送時 git hook 印出的［Ledger］提醒、背景同步的成功與失敗（認證過期會標出來），以及開對話時尚待補跑的專案；每 20 秒讀一次 `~/.ledger_hook.log` 的新增內容，推送後 10 秒提早讀一次；背景執行的 `claude -p` 沒有畫面，不會提醒 | 無 |

## 安裝

1. 把這個 repo clone 到 `~/.claude/mods`：

   ```sh
   git clone https://github.com/TCcodemaster/claude-mods ~/.claude/mods
   ```

2. 在 `~/.claude/settings.json` 加上（一定要放在家目錄的設定檔，專案的設定檔不會生效）：

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/flowmap:~/.claude/mods/gitgraph:~/.claude/mods/env-hint:~/.claude/mods/ledger-hint",
     "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
   }
   ```

   第二行是強制開啟 mod 功能。mod 目前是逐步開放的早期功能，開關狀態快取在本機，偶爾會被存成關閉，導致新對話完全不載入 mod。

3. 使用 VS Code 的話，安裝圖解檢視器，圖就會顯示在旁邊一欄：

   ```sh
   code --install-extension ~/.claude/mods/vscode-viewer/flowmap-viewer.vsix
   ```

4. 重開 Claude Code 對話。

## 自動更新

每次開 Claude Code 對話時，flowmap 會在背景對這個 repo 跑 `git pull --ff-only`，有更新會跳提示。本機有未推送的提交或衝突時會跳過，不會動任何檔案。VS Code 檢視器（`.vsix`）不會自動重裝，更新後要再跑一次安裝步驟 3。

## 圖顯示在哪裡

| 執行環境 | 顯示位置 |
|---|---|
| cmux | cmux 右邊的瀏覽器窗格 |
| VS Code，有裝檢視器 | VS Code 旁邊一欄 |
| VS Code，沒裝檢視器 | 用 mermaid-cli 與 Chrome 渲染成 PNG，在 VS Code 開啟 |
| Claude 桌面版 | 右側面板直接畫成圖：流程圖與樹狀圖（迴圈改成「回到某步驟」標籤）、時序圖、直式時間軸；上方有上一張、下一張、縮小、放大。狀態圖、象限圖、資料表關聯圖目前只列大綱 |
| 其他終端機 | 不另外開視窗，面板顯示縮排大綱，輸入 `/flow` 可再打開 |

## 依賴與限制

- 目前只在 macOS 上測試過。
- 圖的頁面從 jsDelivr 載入 Mermaid，需要網路。
- 判斷要不要畫用 Haiku，畫圖用對話當下的主模型（沿用快取），都算在使用者自己的 Claude 額度。
- gitgraph 只需要 git；它的面板在 VS Code 擴充套件裡不會顯示，只能在終端機裡使用。

## 檢查各台機器是否一致

```sh
~/.claude/mods/check-machines.sh            # 本機加上 ~/.ssh/config 裡的每台主機
~/.claude/mods/check-machines.sh R-engine   # 只檢查指定的主機
```

逐台回報 claude-mods 的提交、是否落後或超前 GitHub、有沒有未提交的修改，以及 `settings.json` 載入了哪些 mod。只做唯讀檢查，不改任何檔案；連不上或需要密碼的主機會標出原因，同一台機器的多個別名只檢查一次。

## 測試

```sh
claude plugin validate flowmap && claude plugin test flowmap
claude plugin validate gitgraph && claude plugin test gitgraph
claude plugin validate env-hint && claude plugin test env-hint
claude plugin validate ledger-hint && claude plugin test ledger-hint
```
