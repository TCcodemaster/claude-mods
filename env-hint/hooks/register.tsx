import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Env } from '../types'

const env = atom({ plugin: 'env-hint', key: 'env' } as const, null, {
  shape: 'env-3',
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

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const now: Env = {
    machine: await firstLine($, ['hostname', '-s']),
    folder: cwd.split('/').filter(Boolean).pop() ?? cwd,
    branch: await firstLine($, ['git', 'branch', '--show-current'], cwd),
  }
  await update($, env, () => now)
}

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

    return (
      <Box>
        {now.machine !== null && (
          <Text>
            <Text dimColor>機器 </Text>
            <Text color="suggestion" bold>{now.machine}</Text>
            <Text dimColor>{'   '}</Text>
          </Text>
        )}
        <Text>
          <Text dimColor>資料夾 </Text>
          <Text color="success" bold>{now.folder}</Text>
          <Text dimColor>{'   '}</Text>
        </Text>
        {now.branch === null ? (
          <Text dimColor>非 git 目錄</Text>
        ) : (
          <Text>
            <Text dimColor>分支 </Text>
            <Text color="merged" bold>{now.branch}</Text>
          </Text>
        )}
      </Box>
    )
  })
}
