import { expect, mock, test } from 'claude-code/testing'

import { continuation, laneText, logArgs, parseLog, parseStatus, pill } from '../hooks/parse'

const LOG = [
  '*   \x01a1b2c3d\x02HEAD -> main, origin/main\x02合併 feature\x02Terry\x0209/17 週四 14:27',
  '|\\  ',
  '| | ',
  '| |  3 files changed, 10 insertions(+)',
  '| * \x01e4f5a6b\x02feature\x02新增登入頁\x02Terry\x0209/16 週三 12:00',
  '| | ',
  '| |  1 file changed, 2 insertions(+)',
  '* | \x01c7d8e9f\x02tag: v1.0\x02修正錯字\x02Terry\x0209/15 週二 15:03',
].join('\n')

test('解析提交、統計與分岔線', () => {
  const commits = parseLog(LOG)
  expect(commits.map(c => c.hash)).toEqual(['a1b2c3d', '', 'e4f5a6b', 'c7d8e9f'])
  expect(commits[0]?.files).toBe(3)
  expect(commits[2]?.files).toBe(1)
  expect(commits[0]?.refs).toEqual(['HEAD -> main', 'origin/main'])
  expect(commits[2]?.author).toBe('Terry')
})

test('線圖字元與接續線', () => {
  expect(laneText('| * ')).toBe('│ ● ')
  expect(laneText('|\\ ')).toBe('│╲ ')
  expect(continuation('* | ')).toBe('│ │ ')
})

test('分支膠囊與分支參數', () => {
  expect(pill('HEAD -> main')).toEqual({ text: 'main', background: 'suggestion' })
  expect(pill('tag: v1.0').text).toBe('v1.0')
  expect(pill('origin/main').background).toBe('subtle')
  expect(logArgs([])).toEqual(['--all'])
  expect(logArgs(['main', 'feature'])).toEqual(['main', 'feature'])
})

test('解析分支狀態', () => {
  expect(parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({ branch: 'main', tracking: 'origin/main  領先 2  落後 1', dirty: 2 })
})

test('面板畫出卡片並可勾選多條分支', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const runs: string[][] = []
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const out = e.argv.includes('status') ? '## main...origin/main [ahead 1]\n M a.ts\n'
      : e.argv.includes('for-each-ref') ? 'main\nfeature\n' : LOG
    return { value: { exitCode: 0, stdout: out, stderr: '' } as never }
  })
  await $.command.run({ command: 'branches', args: 'main feature', origin: { kind: 'person' } as never } as never)
  expect(runs.find(r => r.includes('log'))?.slice(-2)).toEqual(['main', 'feature'])
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const pane = await $.ui.mount({ plugin: 'gitgraph', surface, component: 'Pane', requestId: 'gitgraph', props: {} as never })
    const drawn = JSON.stringify(await pane.drawn())
    for (const text of ['1 個未提交變更', '新增登入頁', ' main ', ' v1.0 ', ' 3 ', '✓ feature']) {
      expect(drawn).toContain(text)
    }
  }
})
