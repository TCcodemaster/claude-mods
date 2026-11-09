import type { EngineInterface, Register } from 'claude-code'

// Ledger 的 git hook（~/ledger-skill/hooks）在家目錄寫的三個檔案：
// 每次 sync 的紀錄、失敗待補跑的清單、補跑中的清單。
const LOG = '.ledger_hook.log'
const PENDING = ['.ledger_sync_failed', '.ledger_sync_retrying']
// 紀錄已讀到第幾行，存在 $.store，同一台機器的各個對話共用。
const SEEN = 'seenLines'
const POLL_MS = 20_000
const MARK = '［Ledger］'

type Hit = { text: string; isFailure: boolean }

// 紀錄裡的結果行，對應到提醒文字；auth 表示前面出現過 claude 認證失敗的訊息。
const RESULTS: [RegExp, (project: string, auth: boolean) => Hit][] = [
  [/^\[[^\]]+\] (\S+) ledger sync 完成$/, p => ({ text: `${p} 的文件已同步到站台`, isFailure: false })],
  [
    /^\[[^\]]+\] (\S+) ledger sync 失敗/,
    (p, auth) => ({
      text: `${p} 同步失敗${auth ? '：背景 claude 認證過期' : ''}，請在 claude 內執行 /ledger sync ${p}`,
      isFailure: true,
    }),
  ],
  [/^\[[^\]]+\] (\S+) 自動補跑完成$/, p => ({ text: `${p} 自動補跑完成`, isFailure: false })],
  [
    /^\[[^\]]+\] (\S+) 自動補跑仍失敗/,
    (p, auth) => ({
      text: `${p} 自動補跑仍失敗${auth ? '：背景 claude 認證過期' : ''}，請在 claude 內執行 /ledger sync ${p}`,
      isFailure: true,
    }),
  ],
  [/^\[[^\]]+\] (\S+) push：找不到 claude/, p => ({ text: `${p} 找不到 claude，這次推送沒有同步`, isFailure: true })],
]

const toast = ($: EngineInterface, hit: Hit) => $.ui.toast(hit.text, { timeoutMs: hit.isFailure ? 12_000 : 5_000 })

let lastMtime = -1
let sawAuthError = false

// 讀紀錄裡上次之後新增的完整行，每個專案只提醒最後一個結果。第一次執行只記下行數，不翻舊帳。
const checkLog = async ($: EngineInterface, home: string) => {
  const log = `${home}/${LOG}`
  const stat = await $.fs.stat(log).catch(() => null)
  if (stat === null || stat.mtimeMs === lastMtime) return
  lastMtime = stat.mtimeMs

  const counted = await $.process.run(['wc', '-l', log], { timeoutMs: 3000 })
  const total = Number(counted.stdout.trim().split(/\s+/)[0])
  if (counted.exitCode !== 0 || !Number.isInteger(total)) return

  const stored = await $.store.get(SEEN)
  await $.store.set(SEEN, total)
  // 行數變少代表紀錄被清過或還原過，只重新記下行數，不把剩下的舊紀錄再跳一次。
  if (typeof stored !== 'number' || stored >= total) return
  const seen = stored

  const ran = await $.process.run(['sed', '-n', `${seen + 1},${total}p`, log], { timeoutMs: 3000 })
  if (ran.exitCode !== 0) return

  const latest = new Map<string, Hit>()
  for (const line of ran.stdout.split('\n')) {
    if (line.includes('Failed to authenticate')) {
      sawAuthError = true
      continue
    }
    for (const [pattern, make] of RESULTS) {
      const project = pattern.exec(line)?.[1]
      if (project === undefined) continue
      latest.delete(project)
      latest.set(project, make(project, sawAuthError))
      sawAuthError = false
      break
    }
  }
  for (const hit of latest.values()) toast($, hit)
}

const pendingProjects = async ($: EngineInterface, home: string) => {
  const names: string[] = []
  for (const file of PENDING) {
    const text = await $.fs.read(`${home}/${file}`).catch(() => '')
    names.push(...text.split('\n').map(name => name.trim()).filter(name => name !== ''))
  }

  return [...new Set(names)]
}

let home: string | undefined
let greeted = false

// 有畫面接上才提醒：桌面版經 SDK 啟動，isInteractive 是 false，但會接上 desktop 畫面；
// 背景跑 sync 的 claude -p 不會接上任何畫面，在那裡不提醒，也不動已讀行數。
const tick = async ($: EngineInterface) => {
  if (home === undefined || (await $.session.surfaces()).length === 0) return
  if (!greeted) {
    greeted = true
    const pending = await pendingProjects($, home)
    if (pending.length > 0) {
      $.ui.toast(`尚待補跑：${pending.join('、')}。請在 claude 內執行 /ledger sync <專案名>`, { timeoutMs: 15_000 })
    }
  }
  await checkLog($, home)
}

// 讀不到 Ledger 的檔案就不提醒，不影響對話。
const safeTick = ($: EngineInterface) => tick($).catch(() => undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    home = await $.env.get('HOME')
    await safeTick($)
    $.clock.every(POLL_MS, () => {
      void safeTick($)
    })

    return started
  })

  // 桌面版在對話開始之後才接上畫面，接上時補做開場提醒。
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await safeTick($)

    return attached
  })

  // 推送時 hook 印在終端機的［Ledger］提醒，改成提醒小框；推送後提早檢查一次結果。
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || !/\bgit\b[^\n]*\bpush\b/.test(e.command)) return ran

    try {
      const notes = (ran.text ?? '')
        .split('\n')
        .filter(line => line.includes(MARK))
        .map(line => line.slice(line.indexOf(MARK) + MARK.length).trim())
      for (const note of new Set(notes)) $.ui.toast(note, { timeoutMs: 8_000 })

      $.clock.after(10_000, () => {
        void safeTick($)
      })
    } catch {
      // 提醒失敗不影響推送的結果。
    }

    return ran
  }).catch(($, e, next) => next(e))
}
