# Claude Code mods

兩個 Claude Code mod（function hooks 外掛），在 Claude Code 自己的介面裡運作。

| mod | 功能 | 指令 |
|---|---|---|
| flowmap | 長回應結束後由 Haiku 判斷是否值得畫圖，值得就產生 Mermaid 圖，顯示在 cmux 瀏覽器窗格 | `/flow`、`/flow hide`、`/flow on\|off`、`/flow web on\|off` |
| gitgraph | 仿 GitHub Desktop 的提交列表，可同時勾選多條分支比對 | `/branches`、`/branches 分支 分支`、`/branches all`、`/branches hide` |

## 安裝

在 `~/.claude/settings.json` 加上：

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/flowmap:~/.claude/mods/gitgraph"
}
```

新開的 Claude Code 對話就會載入，兩個面板都不會自動打開。

## 依賴

- flowmap 的瀏覽器窗格需要在 cmux 裡執行，頁面的 Mermaid 從 jsDelivr 載入。
- gitgraph 只需要 git。

## 測試

```sh
claude plugin validate flowmap && claude plugin test flowmap
claude plugin validate gitgraph && claude plugin test gitgraph
```
