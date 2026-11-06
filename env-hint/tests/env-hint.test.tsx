import { expect, test } from 'claude-code/testing'

test('狀態列顯示機器、資料夾與分支', async ($, on) => {
  const shown: (string | undefined)[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/terry/proj' }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'hostname' ? 'tcMacBook-Air\n' : 'main\n',
      stderr: '',
    },
  }))
  on('ui.status', (_, e) => {
    shown.push(e.text)

    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(shown.at(-1)).toBe('機器 tcMacBook-Air | 資料夾 proj | 分支 main')
})

test('不在 git 目錄時標示出來', async ($, on) => {
  const shown: (string | undefined)[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/scratch' }))
  on('process.run', (_, e) => ({
    value:
      e.argv[0] === 'hostname'
        ? { exitCode: 0, stdout: 'box\n', stderr: '' }
        : { exitCode: 128, stdout: '', stderr: 'not a git repository' },
  }))
  on('ui.status', (_, e) => {
    shown.push(e.text)

    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(shown.at(-1)).toBe('機器 box | 資料夾 scratch | 非 git 目錄')
})
