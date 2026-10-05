import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { checkFlow, JUDGE, parseReply, parseSurface } from '../hooks/flow'

const usage = { input_tokens: 1, output_tokens: 1 } as never
const REPLY = [
  '摘要：先檢查快取再決定是否重建。',
  '```mermaid',
  'flowchart TD',
  '  A(["開始"]):::start --> B{"有快取?"}:::decide',
  '  B -->|是| C["直接使用"]:::done',
  '  B -->|否| D["重新建置"]:::step --> E["注意權限"]:::warn',
  '```',
].join('\n')

type Seen = { prompts: string[]; argv: string[][]; files: string[]; judged: number; verdict: string }

function setup(on: On, seen: Seen) {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { CMUX_WORKSPACE_ID: 'ws-1', HOME: '/home/t', CMUX_BUNDLED_CLI_PATH: '/bin/cmux' })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    const stdout = e.argv.includes('eval') ? 'flowmap-ok' : 'OK surface=abc-123 pane=p'
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('model.complete', (_$, e) => {
    seen.judged += 1
    return { value: { isAnswered: true, text: e.system === JUDGE ? seen.verdict : '', usage } }
  })
  on('model.fork', (_$, e) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: REPLY, usage } }
  })
  return clock
}

const answer = (text: string, extra = {}) => ({ answer: text, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const, ...extra })

test('解析 Mermaid 節點、類別與分支', () => {
  const parsed = parseReply(REPLY)
  expect(parsed?.nodes.map(n => `${n.id}:${n.kind}:${n.label}`)).toEqual([
    'A:start:開始', 'B:decide:有快取?', 'C:done:直接使用', 'D:step:重新建置', 'E:warn:注意權限',
  ])
  expect(parsed?.edges).toEqual([
    { from: 'A', to: 'B', label: '' },
    { from: 'B', to: 'C', label: '是' },
    { from: 'B', to: 'D', label: '否' },
    { from: 'D', to: 'E', label: '' },
  ])
})

test('長回應產生彩色面板並開 cmux 瀏覽器窗格，第二次改用 navigate', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.prompts.length).toBe(1)
  expect(seen.files).toEqual([])
  expect(seen.argv[0]?.slice(0, 3)).toEqual(['/bin/cmux', 'browser', 'open-split'])
  expect(seen.argv[0]?.[3]?.startsWith('data:text/html;charset=utf-8,')).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'flowmap', surface, component: 'Pane', requestId: 'flowmap', props: {} as never })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('先檢查快取再決定是否重建。')
    expect(drawn).toContain('有快取?')
    expect(drawn).toContain('重新建置')
  }
  await $.turn.complete(answer('流程'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.argv[1]?.slice(0, 4)).toEqual(['/bin/cmux', 'browser', 'abc-123', 'eval'])
  expect(seen.argv[1]?.[4]).toContain('flowmapRender')
  expect(seen.argv.length).toBe(2)
})

test('短回應與子代理回應不產生', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('好。'))
  await $.turn.complete(answer('長'.repeat(900), { agentId: 'a1' }))
  await clock.advance(1)
  expect(seen.judged).toBe(0)
  expect(seen.prompts.length).toBe(0)
})

test('心智圖轉成縮排大綱', () => {
  const parsed = parseReply(['摘要：整理三種合併方式。', '```mermaid', 'mindmap', '  root(("合併方式"))', '    merge', '      保留歷史', '    rebase', '```'].join('\n'))
  expect(parsed?.diagram).toBe('mindmap')
  expect(parsed?.outline).toEqual(['合併方式', '  ・merge', '    ・保留歷史', '  ・rebase'])
})

test('象限圖座標自動補中括號', () => {
  const parsed = parseReply(['摘要：比較。', '```mermaid', 'quadrantChart', '  title 方案', '  x-axis 低 --> 高', '  Chrome 後台渲染: 0.3, 0.3', '  cmux 窗格: [0.8, 0.9]', '```'].join('\n'))
  expect(parsed?.mermaid.split('\n').slice(-2)).toEqual(['  Chrome 後台渲染: [0.3, 0.3]', '  cmux 窗格: [0.8, 0.9]'])
})

test('Haiku 判斷不需要圖時不產生', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '否' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('解說'.repeat(300)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.judged).toBe(1)
  expect(seen.prompts.length).toBe(0)
})

test('本機版與遠端版 cmux 的輸出都解析得到窗格', () => {
  expect(parseSurface('OK surface=surface:44 pane=pane:8 placement=split')).toBe('surface:44')
  expect(parseSurface('{\n  "surface_id" : "B8E3-11",\n  "pane_id" : "P1"\n}')).toBe('B8E3-11')
  expect(parseSurface('{"surface_ref": "surface:9"}')).toBe('surface:9')
  expect(parseSurface('Error: unknown command')).toBe(null)
})

test('不在 cmux 也不在 VS Code 時不開任何瀏覽器', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '是', usage } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.prompts.length).toBe(0)
  expect(seen.files).toEqual([])
  expect(seen.argv).toEqual([])
})

test('在 VS Code 裡沒裝檢視器時渲染成 PNG 並用 VS Code 打開', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', PATH: '/usr/bin' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '是', usage } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.files).toEqual(['/home/t/.claude/flowmap/latest.mmd', '/home/t/.claude/flowmap/puppeteer.json'])
  expect(seen.argv[0]?.[0]).toBe('mmdc')
  expect(seen.argv[1]?.slice(1)).toEqual(['-r', '/home/t/.claude/flowmap/latest.png'])
})

test('在 VS Code 裡裝了檢視器時寫出網頁給它顯示', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', VSCODE_PID: '42' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.list', () => ({ value: [{ name: 'tccodemaster.flowmap-viewer-0.1.0', type: 'dir' }] as never }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '是', usage } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.files).toEqual(['/home/t/.claude/flowmap/vscode-42.html', '/home/t/.claude/flowmap/vscode-42.json'])
  expect(seen.argv).toEqual([])
})

test('檢查出判斷少分支、節點過多與孤立節點', () => {
  const bad = parseReply(['摘要：壞圖。', '```mermaid', 'flowchart TD',
    '  A["開始"]:::start --> B{"准許?"}:::decide', '  B -->|否| C["自訴"]:::step', '  Z["孤立"]:::step', '```'].join('\n'))!
  const problems = checkFlow(bad)
  expect(problems.some(p => p.includes('准許?') && p.includes('1 條分支'))).toBe(true)
  expect(problems.some(p => p.includes('孤立'))).toBe(true)
  const many = parseReply(['摘要：多。', '```mermaid', 'flowchart LR',
    '  ' + Array.from({ length: 12 }, (_, i) => `N${i}["步驟${i}"]:::step`).join(' --> '), '```'].join('\n'))!
  expect(checkFlow(many).some(p => p.includes('12 個'))).toBe(true)
  expect(checkFlow(parseReply(REPLY)!)).toEqual([])
})

test('第一次畫錯時帶著問題清單重畫一次', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const BAD = ['摘要：壞圖。', '```mermaid', 'flowchart TD', '  A["開始"]:::start --> B{"准許?"}:::decide', '  B -->|否| C["自訴"]:::step', '```'].join('\n')
  on('model.complete', () => ({ value: { isAnswered: true, text: '是', usage } }))
  on('model.fork', (_$, e) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: seen.prompts.length === 1 ? BAD : REPLY, usage } }
  })
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.prompts.length).toBe(2)
  expect(seen.prompts[1]).toContain('只有 1 條分支')
  const pane = await $.ui.mount({ plugin: 'flowmap', surface: 'terminal', component: 'Pane', requestId: 'flowmap', props: {} as never })
  expect(JSON.stringify(await pane.drawn())).toContain('有快取?')
})
