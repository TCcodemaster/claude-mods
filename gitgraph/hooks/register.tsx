import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitView } from '../types'
import { continuation, DATE_FORMAT, FORMAT, laneSegments, laneText, LIMIT, logArgs, parseLog, parseStatus, pill } from './parse'

const PANE = 'gitgraph'
const TITLE = 'Git 分支'
const view = atom({ plugin: 'gitgraph', key: 'view' } as const, null)
// 勾選要看的分支；空陣列代表全部分支，可同時勾選多條比對。
const selected = atom({ plugin: 'gitgraph', key: 'selected' } as const, [])

// 每 15 秒更新一次，接住在終端機其他地方執行的 git 操作。
const REFRESH_MS = 15000
const MAX_BRANCH_BUTTONS = 6
const MAX_PILLS = 3
// 用 Bash 輸出區的底色：深色主題下就是終端機的黑底，淺色主題會跟著換。
const PANEL_BG = 'bashMessageBackgroundColor'

async function refresh($: EngineInterface): Promise<void> {
  const status = await $.process.run(['git', 'status', '--porcelain=v1', '-b'])
  if (status.exitCode !== 0) {
    const next: GitView = { branch: '', tracking: '', dirty: 0, branches: [], commits: [], error: '目前目錄不是 git repo。' }
    await update($, view, () => next)
    return
  }
  const refs = await $.process.run(['git', 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'])
  const branches = refs.stdout.split('\n').filter(Boolean)
  // 已刪除的分支從勾選中移除。
  const picked = (await read($, selected)).filter(name => branches.includes(name))
  await update($, selected, () => picked)
  const log = await $.process.run([
    'git', '-c', 'color.ui=never', 'log', '--graph', '--shortstat', `-n${LIMIT}`,
    `--date=format:${DATE_FORMAT}`, `--format=${FORMAT}`, ...logArgs(picked),
  ])
  const next: GitView = {
    ...parseStatus(status.stdout),
    branches,
    commits: log.exitCode === 0 ? parseLog(log.stdout) : [],
    error: log.exitCode === 0 ? '' : '這個 repo 還沒有任何提交。',
  }
  await update($, view, () => next)
}

async function toggle($: EngineInterface, name: string): Promise<void> {
  await update($, selected, list =>
    name === '' ? [] : list.includes(name) ? list.filter(one => one !== name) : [...list, name],
  )
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'branches', description: '開啟 Git 分支面板；/branches 名稱 切換分支；/branches hide 收起' })
    // 不自動開面板；輸入 /branches 才打開。計時器只在面板開著時更新。
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        if ((await $.ui.panes()).some(pane => pane.id === PANE)) await refresh($)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'branches' }, async ($, e) => {
    const names = e.args.trim().split(/\s+/).filter(Boolean)
    if (names[0] === 'hide') {
      await $.ui.close({ id: PANE })
      return { text: '已收起 Git 分支面板，輸入 /branches 可再打開。' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    if (names.length > 0) {
      await update($, selected, () => (names.includes('all') ? [] : names))
    }
    await refresh($)
    const picked = await read($, selected)

    return { text: picked.length === 0 ? '顯示全部分支。' : `顯示分支：${picked.join('、')}` }
  })

  // 我執行任何 git 指令後立刻更新，不必等計時器。
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command) && (await $.ui.panes()).some(pane => pane.id === PANE)) void refresh($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, view)
    if (!current) return <Text dimColor>讀取中…</Text>
    if (current.error !== '' && current.commits.length === 0) return <Text dimColor>{current.error}</Text>
    const picked = await read($, selected)

    // 面板自己鋪上終端機主畫面的底色，文字對比才夠。
    const rows = Math.max(1, (e.viewport?.rows ?? 30) - 2)
    return (
      <Box flexDirection="column" backgroundColor={PANEL_BG} paddingX={1} width="100%" minHeight={rows}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="all" label="全部" variant={picked.length === 0 ? 'primary' : undefined} onPress={() => toggle($, '')} />
          <Button key="hide" label="收起" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          {current.branches.slice(0, MAX_BRANCH_BUTTONS).map(name => (
            <Button
              key={`b:${name}`}
              label={picked.includes(name) ? `✓ ${name}` : name}
              variant={picked.includes(name) ? 'primary' : undefined}
              onPress={() => toggle($, name)}
            />
          ))}
        </Box>
        <Text> </Text>

        <Text wrap="truncate-end">
          <Text color="warning">◌ </Text>
          <Text bold color={current.dirty === 0 ? 'text' : 'warning'}>
            {current.dirty === 0 ? '沒有變更' : `${current.dirty} 個未提交變更`}
          </Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color="subtle">{'│ 目前分支 '}</Text>
          <Text bold color="success">{current.branch}</Text>
          {current.tracking !== '' && <Text color="subtle">{`  ${current.tracking}`}</Text>}
        </Text>

        {current.commits.map(commit => {
          if (commit.hash === '') {
            return (
              <Text>{laneSegments(laneText(commit.graph)).map(seg => <Text color={seg.color ?? 'text'}>{seg.text}</Text>)}</Text>
            )
          }
          const lane = laneSegments(laneText(commit.graph))
          const below = laneSegments(laneText(continuation(commit.graph)))
          const draw = (segs: typeof lane) => segs.map(seg => <Text color={seg.color ?? 'text'}>{seg.text}</Text>)
          const pills = commit.refs.filter(ref => !ref.endsWith('/HEAD')).slice(0, MAX_PILLS)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text wrap="truncate-end">
                    {draw(lane)}
                    <Text bold color="text">{commit.subject}</Text>
                  </Text>
                </Box>
                {commit.files > 0 && <Text backgroundColor="subtle" color="inverseText">{` ${commit.files} `}</Text>}
              </Box>
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text wrap="truncate-end">
                    {draw(below)}
                    <Text color="subtle" italic>{commit.author}</Text>
                  </Text>
                </Box>
                {pills.length > 0 ? (
                  <Text>
                    {pills.map(ref => {
                      const p = pill(ref)
                      return (
                        <Text>
                          <Text backgroundColor={p.background} color="inverseText" bold>{` ${p.text} `}</Text>
                          {' '}
                        </Text>
                      )
                    })}
                  </Text>
                ) : (
                  <Text color="subtle" italic>{commit.date}</Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
