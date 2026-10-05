// 監看 flowmap mod 寫出的頁面，有新圖時在旁邊一欄顯示，不搶走焦點。
// mod 依 VS Code 視窗寫 vscode-<VSCODE_PID>.html，每個視窗只看自己的檔案；
// 讀不到 VSCODE_PID 時（例如內建終端機）寫 vscode-default.html，所有視窗都會顯示。
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(os.homedir(), '.claude', 'flowmap')
const FILES = [
  path.join(DIR, `vscode-${process.env.VSCODE_PID || 'default'}.html`),
  path.join(DIR, 'vscode-default.html'),
]

let panel
const seen = new Map()

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

// 兩個檔案中較新的那個。
function newest() {
  return FILES.map(file => ({ file, mtime: mtimeOf(file) })).sort((a, b) => b.mtime - a.mtime)[0]
}

function show(reveal) {
  const { file, mtime } = newest()
  if (mtime === 0) return
  let html
  try {
    html = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'flowmap',
      '圖解',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    )
    panel.onDidDispose(() => {
      panel = undefined
    })
  } else if (reveal) {
    panel.reveal(vscode.ViewColumn.Beside, true)
  }
  panel.webview.html = html
}

// 刪掉已經關閉的 VS Code 視窗留下的檔案，避免每次重開都多一個。
function cleanStale() {
  let names = []
  try {
    names = fs.readdirSync(DIR)
  } catch {
    return
  }
  for (const name of names) {
    const m = /^vscode-(\d+)\.html$/.exec(name)
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
  for (const file of FILES) seen.set(file, mtimeOf(file))
  // 用輪詢而不是 fs.watch：mod 每次是整檔覆寫，輪詢在各平台都穩定。
  const timer = setInterval(() => {
    let changed = false
    for (const file of FILES) {
      const mtime = mtimeOf(file)
      if (mtime !== seen.get(file)) {
        seen.set(file, mtime)
        changed = mtime !== 0 || changed
      }
    }
    if (changed) show(true)
  }, 1000)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  context.subscriptions.push(vscode.commands.registerCommand('flowmap.show', () => show(true)))
}

// 視窗關閉時刪掉自己的檔案。
function deactivate() {
  if (!process.env.VSCODE_PID) return
  try {
    fs.unlinkSync(FILES[0])
  } catch {}
}

module.exports = { activate, deactivate }
