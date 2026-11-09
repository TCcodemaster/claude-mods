import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'env-hint',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const seed = (
  on: Parameters<Parameters<typeof test>[1]>[1],
  isRepo: boolean,
) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/Users/terry/proj' }))
  on('process.run', (_, e) => ({
    value:
      e.argv[0] === 'hostname'
        ? { exitCode: 0, stdout: 'tcMacBook-Air\n', stderr: '' }
        : isRepo
          ? { exitCode: 0, stdout: 'main\n', stderr: '' }
          : { exitCode: 128, stdout: '', stderr: 'not a git repository' },
  }))
}

test('輸入框上方以顏色標示機器、資料夾與分支', async ($, on) => {
  seed(on, true)
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const machine = await ui.find({ type: 'Text', text: /^tcMacBook-Air$/ })
    expect(machine?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: /^proj$/ }))?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: /^main$/ }))?.props.color).toBe('merged')
    const line = await ui.find({ type: 'Text', text: /tcMacBook-Air \/ proj \/ main/ })
    expect(line?.props.size).toBe('footnote')
    expect(await ui.find({ type: 'Text', text: /機器|資料夾|分支/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('不在 git 目錄時標示出來', async ($, on) => {
  seed(on, false)
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '非 git 目錄' })).toBeDefined()
  await ui.unmount()
})

test('其他 mod 已畫在框裡時讓位', async ($, on) => {
  seed(on, true)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>flowmap 卡片</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'flowmap 卡片' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^tcMacBook-Air$/ })).toBeUndefined()
  await ui.unmount()
})
