// 監看 flowmap mod 寫出的圖，有新圖時在旁邊一欄顯示，不搶走焦點。
// mod 依 VS Code 視窗寫 vscode-<VSCODE_PID>.html 與 .json，每個視窗只看自己的檔案；
// 讀不到 VSCODE_PID 時（例如內建終端機）寫 vscode-default.*，所有視窗都會顯示。
// 第一次用 .html 開頁面；之後讀 .json 用 postMessage 換圖，頁面保留上一張、下一張的紀錄。
// 圖解預設不顯示：mod 畫好後寫 -offer 檔，這裡跳通知問要不要看，按「看圖解」或 ctrl+alt+g 才打開。
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(os.homedir(), '.claude', 'flowmap')
const BASES = [`vscode-${process.env.VSCODE_PID || 'default'}`, 'vscode-default']

let panel
const seen = new Map()
// 最新一則還沒回覆的詢問，給快捷鍵使用。
let pending

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function show(base) {
  if (!panel) {
    let html
    try {
      html = fs.readFileSync(path.join(DIR, `${base}.html`), 'utf8')
    } catch {
      return
    }
    panel = vscode.window.createWebviewPanel(
      'flowmap',
      '圖解',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    )
    panel.onDidDispose(() => {
      panel = undefined
    })
    // 頁面的匯出按鈕送來檔案內容，開存檔對話框寫出去（webview 裡的下載連結不會動作）。
    panel.webview.onDidReceiveMessage(message => {
      if (message && message.type === 'flowmap-save') void save(message)
    })
    panel.webview.html = html
    return
  }
  let data
  try {
    data = JSON.parse(fs.readFileSync(path.join(DIR, `${base}.json`), 'utf8'))
  } catch {
    return
  }
  panel.reveal(vscode.ViewColumn.Beside, true)
  panel.webview.postMessage(data)
}

async function save({ name, text, base64 }) {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', name)),
  })
  if (!target) return
  const data = base64 !== undefined ? Buffer.from(base64, 'base64') : Buffer.from(text, 'utf8')
  await vscode.workspace.fs.writeFile(target, data)
  vscode.window.setStatusBarMessage(`圖解已存到 ${target.fsPath}`, 5000)
}

async function offer(base) {
  pending = base
  const choice = await vscode.window.showInformationMessage('◆ 圖解：要看這則回應的圖解嗎？', '看圖解', '不用')
  // 通知還沒按之前又來了新的一則，舊通知的選擇就不算數。
  if (pending !== base) return
  pending = undefined
  if (choice === '看圖解') show(`${base}-offer`)
}

// 刪掉已經關閉的 VS Code 視窗留下的檔案，避免每次重開都多一組。
function cleanStale() {
  let names = []
  try {
    names = fs.readdirSync(DIR)
  } catch {
    return
  }
  for (const name of names) {
    const m = /^vscode-(\d+)(-offer)?\.(html|json)$/.exec(name)
    if (!m || m[1] === process.env.VSCODE_PID) continue
    try {
      process.kill(Number(m[1]), 0)
    } catch {
      try {
        fs.unlinkSync(path.join(DIR, name))
      } catch {}
    }
  }
}

function activate(context) {
  fs.mkdirSync(DIR, { recursive: true })
  cleanStale()
  for (const base of BASES) {
    seen.set(base, mtimeOf(path.join(DIR, `${base}.json`)))
    seen.set(`${base}-offer`, mtimeOf(path.join(DIR, `${base}-offer.json`)))
  }
  // 用輪詢而不是 fs.watch：mod 每次是整檔覆寫，輪詢在各平台都穩定。
  const timer = setInterval(() => {
    for (const base of BASES) {
      const mtime = mtimeOf(path.join(DIR, `${base}.json`))
      if (mtime !== seen.get(base)) {
        seen.set(base, mtime)
        if (mtime !== 0) show(base)
      }
      const offered = mtimeOf(path.join(DIR, `${base}-offer.json`))
      if (offered !== seen.get(`${base}-offer`)) {
        seen.set(`${base}-offer`, offered)
        if (offered !== 0) void offer(base)
      }
    }
  }, 1000)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  context.subscriptions.push(
    vscode.commands.registerCommand('flowmap.show', () => {
      const newest = BASES.map(base => ({ base, mtime: mtimeOf(path.join(DIR, `${base}.json`)) })).sort(
        (a, b) => b.mtime - a.mtime,
      )[0]
      if (newest && newest.mtime !== 0) show(newest.base)
    }),
    vscode.commands.registerCommand('flowmap.accept', () => {
      if (!pending) return
      const base = pending
      pending = undefined
      show(`${base}-offer`)
    }),
  )
}

// 視窗關閉時刪掉自己的檔案。
function deactivate() {
  if (!process.env.VSCODE_PID) return
  for (const name of ['', '-offer']) {
    for (const ext of ['html', 'json']) {
      try {
        fs.unlinkSync(path.join(DIR, `vscode-${process.env.VSCODE_PID}${name}.${ext}`))
      } catch {}
    }
  }
}

module.exports = { activate, deactivate }
