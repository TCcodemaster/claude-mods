import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Env } from '../types'

const env = atom({ plugin: 'env-hint', key: 'env' } as const, null, {
  shape: 'env-4',
})

const firstLine = async ($: EngineInterface, argv: string[], cwd?: string) => {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs: 3000 })
    const text = ran.stdout.trim()

    return ran.exitCode === 0 && text !== '' ? text : null
  } catch {
    return null
  }
}

// 一次 git status 取得未提交的檔案數，以及超前上游、尚未推送的提交數；沒有上游時為 null。
const gitCounts = async ($: EngineInterface, cwd: string) => {
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { cwd, timeoutMs: 3000 })
    if (ran.exitCode !== 0) return { changes: 0, unpushed: null }
    const [head = '', ...files] = ran.stdout.split('\n').filter(line => line !== '')
    const ahead = /\bahead (\d+)/.exec(head)
    return { changes: files.length, unpushed: head.includes('...') ? Number(ahead?.[1] ?? 0) : null }
  } catch {
    return { changes: 0, unpushed: null }
  }
}

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const branch = await firstLine($, ['git', 'branch', '--show-current'], cwd)
  const now: Env = {
    machine: await firstLine($, ['hostname', '-s']),
    folder: cwd.split('/').filter(Boolean).pop() ?? cwd,
    branch,
    ...(branch === null ? { changes: 0, unpushed: null } : await gitCounts($, cwd)),
  }
  await update($, env, () => now)
}

// 線條 icon：鉛筆代表未提交的修改，指向橫線的向上箭頭代表未推送的提交。顏色與數字相同，深色模式自動換色。
const ICONS = {
  changes: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  unpushed: '<path d="M12 20V9"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>',
}
const iconSvg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#d99a00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><style>@media (prefers-color-scheme: dark){svg{stroke:#f2c14e}}</style>${paths}</svg>`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // 0.2 版用狀態列顯示，清掉可能留下的那一行。
    $.ui.status(undefined)
    await refresh($)

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    await refresh($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)

    return done
  })

  // 輸入框上方的框同時只能畫一個 mod：其他 mod（如 flowmap）要用時先讓位。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const now = await read($, env)

    if (below.type !== 'engine' || e.props.hasSurvey || now === null) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const counts = [
      { key: 'changes' as const, label: '未提交', count: now.changes },
      { key: 'unpushed' as const, label: '未推送', count: now.unpushed ?? 0 },
    ].filter(item => item.count > 0)
    // 三個值用顏色區分：機器藍色粗體，資料夾綠、分支紫；靠右對齊，中間用淡色斜線隔開。
    // 分支後面再接未提交的檔案數與未推送的提交數（桌面版用線條 icon，終端機用文字），都是 0 就不顯示。
    const parts = [
      ...(now.machine === null ? [] : [<Text color="suggestion" weight="bold">{now.machine}</Text>]),
      <Text color="success">{now.folder}</Text>,
      // 不在 git 目錄時不顯示分支。
      ...(now.branch === null ? [] : [<Text color="merged">{now.branch}</Text>]),
    ]

    const line = (
      <Text size="body" wrap="truncate-end">
        {parts.flatMap((part, i) => (i === 0 ? [part] : [<Text dimColor>{' / '}</Text>, part]))}
        {/* 終端機畫不了圖，數字前面改用文字說明。 */}
        {e.surface === 'terminal' &&
          counts.flatMap(item => [<Text dimColor>{`  ${item.label} `}</Text>, <Text color="warning" weight="bold">{String(item.count)}</Text>])}
      </Text>
    )
    if (e.surface === 'terminal') {
      return (
        <Box width="100%" justifyContent="flex-end">
          {line}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return (
      <Box width="100%" justifyContent="flex-end" alignItems="center">
        {line}
        {counts.map(item => (
          <Box key={`env-hint-${item.key}`} marginLeft={2} alignItems="center" gap={1}>
            <Svg source={iconSvg(ICONS[item.key])} alt={item.label} width={14} height={14} />
            <Text size="body" color="warning" weight="bold">{String(item.count)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
