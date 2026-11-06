import type { EngineInterface, Register } from 'claude-code'

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
  const machine = await firstLine($, ['hostname', '-s'])
  const branch = await firstLine($, ['git', 'branch', '--show-current'], cwd)
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd

  const labels = [
    ...(machine === null ? [] : [`機器 ${machine}`]),
    `資料夾 ${folder}`,
    branch === null ? '非 git 目錄' : `分支 ${branch}`,
  ]

  $.ui.status(labels.join(' | '))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
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
}
