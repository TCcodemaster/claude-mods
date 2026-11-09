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

const CLEAN = '## main...origin/main\n'

const seed = (
  on: Parameters<Parameters<typeof test>[1]>[1],
  isRepo: boolean,
  status = CLEAN,
) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/Users/terry/proj' }))
  on('process.run', (_, e) => ({
    value:
      e.argv[0] === 'hostname'
        ? { exitCode: 0, stdout: 'tcMacBook-Air\n', stderr: '' }
        : !isRepo
          ? { exitCode: 128, stdout: '', stderr: 'not a git repository' }
          : e.argv.includes('status')
            ? { exitCode: 0, stdout: status, stderr: '' }
            : { exitCode: 0, stdout: 'main\n', stderr: '' },
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
    expect(line?.props.size).toBe('body')
    expect((await ui.find({ type: 'Box' }))?.props.justifyContent).toBe('flex-end')
    expect((await ui.find({ type: 'Text', text: /^tcMacBook-Air$/ }))?.props.weight).toBe('bold')
    expect((await ui.find({ type: 'Text', text: /^proj$/ }))?.props.weight).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^proj$/ }))?.props.bold).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /機器|資料夾|分支/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('不在 git 目錄時只顯示機器與資料夾', async ($, on) => {
  seed(on, false)
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^tcMacBook-Air \/ proj$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /git/ })).toBeUndefined()
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

test('分支後面顯示未提交的檔案數與未推送的提交數', async ($, on) => {
  seed(on, true, '## main...origin/main [ahead 2, behind 1]\n M hooks/a.ts\n?? notes.md\nA  b.ts\n')
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // 桌面版：線條 icon 加數字，不出現文字標籤。
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const changes = JSON.stringify((await ui.find({ type: 'Box', key: 'env-hint-changes' }))?.children)
  const unpushed = JSON.stringify((await ui.find({ type: 'Box', key: 'env-hint-unpushed' }))?.children)
  expect(changes).toContain('"alt":"未提交"')
  expect(unpushed).toContain('"alt":"未推送"')
  expect((await ui.find({ type: 'Svg' }))?.props.width).toBe(14)
  expect((await ui.find({ type: 'Text', text: /^3$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^2$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: /未提交|未推送/ })).toBeUndefined()
  await ui.unmount()

  // 終端機：畫不了圖，改用文字。
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /main  未提交 3  未推送 2$/ })).toBeDefined()
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})

test('乾淨時不顯示數字；沒有上游時只顯示未提交', async ($, on) => {
  seed(on, true, '## main\n M a.ts\n')
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /main  未提交 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /未推送/ })).toBeUndefined()
  await ui.unmount()
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Box', key: 'env-hint-changes' })).toBeDefined()
  expect(await desktop.find({ type: 'Box', key: 'env-hint-unpushed' })).toBeUndefined()
  await desktop.unmount()
})
