import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/terry'
const LOG = `${HOME}/.ledger_hook.log`

type On = Parameters<typeof mock.store>[0]

// 模擬家目錄裡的 Ledger 檔案；沒列出的檔案視為不存在。log 傳函式可在測試中途改內容。
const seed = (
  on: On,
  files: Record<string, string | (() => string)>,
  toasts: string[],
  surfaces: readonly ('desktop' | 'terminal')[] = ['desktop'],
) => {
  const text = (path: string) => {
    const value = files[path]
    return typeof value === 'function' ? value() : value
  }
  mock.env(on, { HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const value = text(e.path)
    if (value === undefined) throw new Error('ENOENT')
    return { value }
  })
  on('fs.stat', (_, e) => {
    const value = text(e.path)
    if (value === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: value.length, mtimeMs: value.length, isLink: false } }
  })
  const out = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_, e) => {
    const lines = (text(LOG) ?? '').split('\n').slice(0, -1)
    if (e.argv[0] === 'wc') return out(`${lines.length} ${LOG}\n`)
    const [from = 1, to = lines.length] = String(e.argv[2]).replace('p', '').split(',').map(Number)
    return out(lines.slice(from - 1, to).join('\n') + '\n')
  })
}

const OLD = '[2026-11-02 14:00:57] medreportgen push -> ledger sync 開始\n[2026-11-02 14:01:04] medreportgen ledger sync 失敗（exit=1），請手動重跑\n'

test('桌面版開對話時列出尚待補跑的專案，第一次執行不翻舊紀錄', async ($, on) => {
  const toasts: string[] = []
  mock.store(on)
  mock.clock(on)
  seed(on, { [`${HOME}/.ledger_sync_retrying`]: 'busapi\nfeedback-system\n', [`${HOME}/.ledger_sync_failed`]: 'busapi\n', [LOG]: OLD }, toasts)

  // 桌面版經 SDK 啟動：isInteractive 是 false，但有接上 desktop 畫面。
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })

  expect(toasts).toEqual(['尚待補跑：busapi、feedback-system。請在 claude 內執行 /ledger sync <專案名>'])
})

test('推送後紀錄出現新結果時提醒，並標出認證過期', async ($, on) => {
  const toasts: string[] = []
  let log = OLD
  mock.store(on)
  const clock = mock.clock(on)
  seed(on, { [LOG]: () => log }, toasts)
  on('tool.call', () => ({ result: {}, text: 'To origin\n［Ledger］已在背景更新 medreportgen 的文件（log：~/.ledger_hook.log）\n' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(toasts).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'git push origin master' })
  expect(toasts).toEqual(['已在背景更新 medreportgen 的文件（log：~/.ledger_hook.log）'])

  log +=
    '[2026-11-05 22:10:39] medreportgen push -> ledger sync 開始\n' +
    'Failed to authenticate: OAuth session expired and could not be refreshed\n' +
    '[2026-11-05 22:10:45] medreportgen ledger sync 失敗（exit=1），請手動重跑\n' +
    '[2026-11-05 22:11:00] xiri ledger sync 完成\n'
  await clock.advance(10_000)

  expect(toasts.slice(1)).toEqual([
    'medreportgen 同步失敗：背景 claude 認證過期，請在 claude 內執行 /ledger sync medreportgen',
    'xiri 的文件已同步到站台',
  ])

  // 沒有新內容就不再提醒。
  await clock.advance(20_000)
  expect(toasts.length).toBe(3)
})

test('背景的 claude -p 沒有畫面，不提醒，不是推送的指令也不提醒', async ($, on) => {
  const toasts: string[] = []
  mock.store(on, { seenLines: 0 })
  mock.clock(on)
  seed(on, { [`${HOME}/.ledger_sync_failed`]: 'busapi\n', [LOG]: OLD }, toasts, [])
  on('tool.call', () => ({ result: {}, text: '［Ledger］此專案尚未登記\n' }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  expect(toasts).toEqual([])
})
