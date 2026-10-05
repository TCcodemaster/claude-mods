# Claude Code mods

兩個 Claude Code mod（function hooks 外掛），在 Claude Code 自己的介面裡運作。

| mod | 功能 | 指令 |
|---|---|---|
| flowmap | 長回應結束後由 Haiku 判斷是否值得畫圖，值得就產生 Mermaid 圖，顯示在 cmux 瀏覽器窗格 | `/flow`、`/flow hide`、`/flow on\|off`、`/flow web on\|off` |
| gitgraph | 仿 GitHub Desktop 的提交列表，可同時勾選多條分支比對 | `/branches`、`/branches 分支 分支`、`/branches all`、`/branches hide` |

## 安裝

1. 把這個 repo clone 到 `~/.claude/mods`：

   ```sh
   git clone https://github.com/TCcodemaster/claude-mods ~/.claude/mods
   ```

2. 在 `~/.claude/settings.json` 加上（一定要放在家目錄的設定檔，專案的設定檔不會生效）：

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/flowmap:~/.claude/mods/gitgraph"
   }
   ```

3. 使用 VS Code 的話，安裝圖解檢視器，圖就會顯示在旁邊一欄：

   ```sh
   code --install-extension ~/.claude/mods/vscode-viewer/flowmap-viewer.vsix
   ```

4. 重開 Claude Code 對話。

## 圖顯示在哪裡

| 執行環境 | 顯示位置 |
|---|---|
| cmux | cmux 右邊的瀏覽器窗格 |
| VS Code，有裝檢視器 | VS Code 旁邊一欄 |
| VS Code，沒裝檢視器 | 用 mermaid-cli 與 Chrome 渲染成 PNG，在 VS Code 開啟 |
| 其他 | 系統預設瀏覽器 |

## 依賴與限制

- 目前只在 macOS 上測試過。
- 圖的頁面從 jsDelivr 載入 Mermaid，需要網路。
- 判斷與畫圖會呼叫 Haiku，用的是使用者自己的 Claude 額度。
- gitgraph 只需要 git；它的面板在 VS Code 擴充套件裡不會顯示，只能在終端機裡使用。

## 測試

```sh
claude plugin validate flowmap && claude plugin test flowmap
claude plugin validate gitgraph && claude plugin test gitgraph
```
