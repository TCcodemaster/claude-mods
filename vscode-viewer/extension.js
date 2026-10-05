// 監看 flowmap mod 寫出的圖，有新圖時在旁邊一欄顯示，不搶走焦點。
// mod 依 VS Code 視窗寫 vscode-<VSCODE_PID>.html 與 .json，每個視窗只看自己的檔案；
// 讀不到 VSCODE_PID 時（例如內建終端機）寫 vscode-default.*，所有視窗都會顯示。
// 第一次用 .html 開頁面；之後讀 .json 用 postMessage 換圖，頁面保留上一張、下一張的紀錄。
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(os.homedir(), '.claude', 'flowmap')
const BASES = [`vscode-${process.env.VSCODE_PID || 'default'}`, 'vscode-default']

let panel
const seen = new Map()

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

// 刪掉已經關閉的 VS Code 視窗留下的檔案，避免每次重開都多一組。
function cleanStale() {
  let names = []
  try {
    names = fs.readdirSync(DIR)
  } catch {
    return
  }
  for (const name of names) {
    const m = /^vscode-(\d+)\.(html|json)$/.exec(name)
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
  for (const base of BASES) seen.set(base, mtimeOf(path.join(DIR, `${base}.json`)))
  // 用輪詢而不是 fs.watch：mod 每次是整檔覆寫，輪詢在各平台都穩定。
  const timer = setInterval(() => {
    for (const base of BASES) {
      const mtime = mtimeOf(path.join(DIR, `${base}.json`))
      if (mtime !== seen.get(base)) {
        seen.set(base, mtime)
        if (mtime !== 0) show(base)
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
  )
}

// 視窗關閉時刪掉自己的檔案。
function deactivate() {
  if (!process.env.VSCODE_PID) return
  for (const ext of ['html', 'json']) {
    try {
      fs.unlinkSync(path.join(DIR, `vscode-${process.env.VSCODE_PID}.${ext}`))
    } catch {}
  }
}

module.exports = { activate, deactivate }
