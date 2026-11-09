import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BOOT_HTML, checkFlow, CMUX_LIMIT, findPane, JUDGE, outlineFlow, parseReply, parseSurface, renderScripts, toDataUrl } from '../hooks/flow'
import type { FlowLine } from '../hooks/flow'
import { flowSvg, layoutFlow, wrapLabel } from '../hooks/svg'
import { drawSequence, drawTimeline, parseSequence, parseTimeline } from '../hooks/diagrams'

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

// reply 換掉模型畫的圖；run 換掉 cmux 指令的回應（給分段送圖的情境）。
function setup(on: On, seen: Seen, reply = REPLY, run?: (argv: string[]) => string) {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { CMUX_WORKSPACE_ID: 'ws-1', HOME: '/home/t', CMUX_BUNDLED_CLI_PATH: '/bin/cmux' })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  // 測試裡沒有引擎自己的按鈕列，mod 讓出時畫一行替代文字。
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, '引擎預設') as RenderElement
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    const stdout = run ? run([...e.argv]) : e.argv.includes('browser.eval') ? (e.argv[3]?.includes('typeof') ? '{"value":"function"}' : '{"value":"flowmap-ok"}') : 'OK surface=abc-123 pane=p'
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('model.complete', (_$, e) => {
    if (e.system === JUDGE) {
      seen.judged += 1
      return { value: { isAnswered: true, text: seen.verdict, usage } }
    }
    seen.prompts.push(String(e.prompt))
    return { value: { isAnswered: true, text: reply, usage } }
  })
  return clock
}

// 模擬使用者在提示框上方按「看圖解」。
async function look($: Engine) {
  const band = await $.ui.mount({ plugin: 'flowmap', component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, isWorking: false } as never })
  await band.press({ key: 'flowmap-show' })
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

test('長回應產生彩色面板並開 cmux 瀏覽器窗格，第二次改用 browser.eval 換圖', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  expect(seen.prompts.length).toBe(1)
  expect(seen.files).toEqual([])
  expect(seen.argv[0]?.slice(0, 3)).toEqual(['/bin/cmux', '--json', 'list-panels'])
  expect(seen.argv[1]?.slice(0, 3)).toEqual(['/bin/cmux', 'browser', 'open-split'])
  expect(seen.argv[1]?.[3]).toBe(toDataUrl(BOOT_HTML))
  expect(seen.argv[1]?.[3]?.length).toBeLessThanOrEqual(CMUX_LIMIT)
  const scripts = seen.argv.slice(2).map(argv => (JSON.parse(argv[3] ?? '{}') as { script: string }).script)
  expect(scripts[0]).toBe('typeof window.flowmapBoot')
  expect(scripts.at(-1)).toContain('window.flowmapBoot(window.flowmapBuf)')
  const opened = seen.argv.length
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
  await look($)
  expect(seen.argv[opened]?.slice(0, 3)).toEqual(['/bin/cmux', 'rpc', 'browser.eval'])
  expect(JSON.parse(seen.argv[opened]?.[3] ?? '{}').surface_id).toBe('abc-123')
  expect(seen.argv[opened]?.[3]).toContain('flowmapRenderB64')
  expect(seen.argv.length).toBe(opened + 1)
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

test('完整頁面塞不進 cmux 單次請求時，先開啟動頁再把整頁分段送入', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const big = ['```mermaid', 'flowchart TD', ...Array.from({ length: 300 }, (_, i) => `  N${i}["步驟${i}，確認資料後送出"] --> N${i + 1}`), '```'].join('\n')
  const clock = setup(on, seen, `摘要：很長的流程。\n${big}`)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  const evals = seen.argv.filter(argv => argv[1] === 'rpc').map(argv => (JSON.parse(argv[3] ?? '{}') as { script: string }).script)
  expect(evals[0]).toBe('typeof window.flowmapBoot')
  expect(evals.length).toBeGreaterThan(4)
  expect(evals[1]?.startsWith('(window.flowmapBuf = "')).toBe(true)
  expect(evals.at(-1)).toContain('window.flowmapBoot(window.flowmapBuf)')
  for (const argv of seen.argv) expect((argv[3] ?? '').length).toBeLessThanOrEqual(CMUX_LIMIT + 200)
})

test('renderScripts 小圖一段送，大圖拆段累積後才畫', () => {
  const small = renderScripts('摘要：小', 'flowchart TD\n  A --> B', '00:00')
  expect(small.length).toBe(1)
  expect(small[0]).toContain("'flowmap-ok'")
  const chunked = renderScripts('摘要：大', 'x'.repeat(100), '00:00', 40)
  expect(chunked.length).toBeGreaterThan(2)
  expect(chunked[0]?.startsWith('(window.flowmapBuf = "')).toBe(true)
  expect(chunked[1]?.startsWith('(window.flowmapBuf = window.flowmapBuf + "')).toBe(true)
  expect(chunked.at(-1)).toContain('window.flowmapRenderB64(window.flowmapBuf)')
  const joined = chunked.slice(0, -1).map(line => /"([^"]*)"/.exec(line)?.[1] ?? '').join('')
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(joined), ch => ch.charCodeAt(0)))
  expect(JSON.parse(decoded)).toEqual(['大', 'x'.repeat(100), '00:00'])
})

test('本機版與遠端版 cmux 的輸出都解析得到窗格', () => {
  expect(parseSurface('OK surface=surface:44 pane=pane:8 placement=split')).toBe('surface:44')
  expect(parseSurface('{\n  "surface_id" : "B8E3-11",\n  "pane_id" : "P1"\n}')).toBe('B8E3-11')
  expect(parseSurface('{"surface_ref": "surface:9"}')).toBe('surface:9')
  expect(parseSurface('Error: unknown command')).toBe(null)
})

test('從工作區清單找回已經開著的圖解分頁', () => {
  const panel = (ref: string, title: string, selected = false, type = 'browser') => ({ ref, title, type, selected_in_pane: selected })
  const list = (...surfaces: object[]) => JSON.stringify({ surfaces })
  expect(findPane(list(panel('surface:1', 'zsh', true, 'terminal'), panel('surface:2', '圖解'), panel('surface:3', '圖解')))).toBe('surface:3')
  expect(findPane(list(panel('surface:2', '圖解', true), panel('surface:3', '圖解')))).toBe('surface:2')
  expect(findPane(list(panel('surface:4', 'GitHub', true)))).toBe(null)
  expect(findPane('OK surface=abc')).toBe(null)
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
  on('model.complete', (_$, e) => ({ value: { isAnswered: true, text: e.system === JUDGE ? '是' : REPLY, usage } }))
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
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  mock.env(on, { HOME: '/home/t', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', PATH: '/usr/bin' })
  // 引擎自己的提示列：下層沒有其他 mod 畫東西。
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('model.complete', (_$, e) => ({ value: { isAnswered: true, text: e.system === JUDGE ? '是' : REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  expect(seen.files).toEqual(['/home/t/.claude/flowmap/latest.mmd', '/home/t/.claude/flowmap/puppeteer.json'])
  expect(seen.argv[0]?.[0]).toBe('mmdc')
  expect(seen.argv[1]?.slice(1)).toEqual(['-r', '/home/t/.claude/flowmap/latest.png'])
})

test('在 VS Code 裡裝了檢視器時寫出網頁給它顯示', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  mock.env(on, { HOME: '/home/t', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', VSCODE_PID: '42' })
  // 引擎自己的提示列：下層沒有其他 mod 畫東西。
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
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
  on('model.complete', (_$, e) => ({ value: { isAnswered: true, text: e.system === JUDGE ? '是' : REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  expect(seen.files.slice(-2)).toEqual(['/home/t/.claude/flowmap/vscode-42.html', '/home/t/.claude/flowmap/vscode-42.json'])
  const band = await $.ui.mount({ plugin: 'flowmap', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false, isWorking: false } as never })
  expect(JSON.stringify(await band.drawn())).not.toContain('flexGrow')
  expect(seen.argv).toEqual([])
})

test('檢查出判斷少分支、節點過多與孤立節點', () => {
  const bad = parseReply(['摘要：壞圖。', '```mermaid', 'flowchart TD',
    '  A["開始"]:::start --> B{"准許?"}:::decide', '  B -->|否| C["自訴"]:::step', '  Z["孤立"]:::step', '```'].join('\n'))!
  const problems = checkFlow(bad)
  expect(problems.some(p => p.includes('准許?') && p.includes('1 條分支'))).toBe(true)
  expect(problems.some(p => p.includes('孤立'))).toBe(true)
  const many = parseReply(['摘要：多。', '```mermaid', 'flowchart LR',
    '  ' + Array.from({ length: 34 }, (_, i) => `N${i}["步驟${i}"]:::step`).join(' --> '), '```'].join('\n'))!
  expect(checkFlow(many).some(p => p.includes('34 個'))).toBe(true)
  expect(checkFlow(parseReply(REPLY)!)).toEqual([])
})

test('第一次畫錯時帶著問題清單重畫一次', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const BAD = ['摘要：壞圖。', '```mermaid', 'flowchart TD', '  A["開始"]:::start --> B{"准許?"}:::decide', '  B -->|否| C["自訴"]:::step', '```'].join('\n')
  on('model.complete', (_$, e) => {
    if (e.system === JUDGE) return { value: { isAnswered: true, text: '是', usage } }
    seen.prompts.push(String(e.prompt))
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

const BAND = { plugin: 'flowmap', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never } as const

test('預設不顯示，只出現精簡的「看圖解 · 不用」；按了才打開背景先畫好的圖', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.prompts.length).toBe(1)
  expect(seen.argv).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const offer = JSON.stringify(await band.drawn())
  expect(offer).toContain('看圖解')
  expect(offer).not.toContain('borderStyle')
  expect(offer).toContain('flowmap-dismiss')
  // 下層畫的內容（測試裡是「引擎預設」，實際上是 env-hint 的環境資訊）保留在同一行。
  expect(offer).toContain('引擎預設')
  await band.press({ key: 'flowmap-show' })
  expect(seen.prompts.length).toBe(1)
  expect(seen.argv.some(argv => argv[1] === 'browser' && argv[2] === 'open-split')).toBe(true)
  expect(JSON.stringify(await band.drawn())).toContain('收起圖解')
  await band.press({ key: 'flowmap-hide' })
  expect(seen.argv.at(-1)?.slice(0, 3)).toEqual(['/bin/cmux', 'rpc', 'surface.close'])
  expect(JSON.parse(seen.argv.at(-1)?.[3] ?? '{}')).toEqual({ workspace_id: 'ws-1', surface_id: 'abc-123' })
  expect(JSON.stringify(await band.drawn())).toContain('看圖解')
})

test('按「不用」後按鈕消失，只留下層的內容', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'flowmap-dismiss' })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('引擎預設')
  expect(drawn).not.toContain('flowmap-show')
})

test('新的回合在跑時收起按鈕', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  const band = await $.ui.mount({ plugin: 'flowmap', component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, isWorking: true } as never })
  expect(JSON.stringify(await band.drawn())).toContain('引擎預設')
})

test('Haiku 判斷不畫時不出現詢問', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '否' }
  const clock = setup(on, seen)
  await $.turn.complete(answer('解說'.repeat(300)))
  await clock.advance(1)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(JSON.stringify(await band.drawn())).toContain('引擎預設')
})

test('自動產生關閉時直接詢問，按「看圖解」才請模型畫', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen)
  await $.command.run({ command: 'flow', args: 'off' } as never)
  await $.turn.complete(answer('解說'.repeat(300)))
  await clock.advance(1)
  expect(seen.judged).toBe(0)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(JSON.stringify(await band.drawn())).toContain('看圖解')
  await band.press({ key: 'flowmap-show' })
  expect(seen.prompts.length).toBe(1)
  expect(seen.argv.some(argv => argv[1] === 'browser' && argv[2] === 'open-split')).toBe(true)
})

test('VS Code 擴充套件裡畫好後寫出 -offer 檔，交給檢視器跳通知詢問', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', VSCODE_PID: '42' })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.list', () => ({ value: [{ name: 'tccodemaster.flowmap-viewer-0.3.0', type: 'dir' }] as never }))
  on('fs.write', (_$, e) => {
    seen.files.push(e.path)
    return { value: undefined }
  })
  on('model.complete', (_$, e) => ({ value: { isAnswered: true, text: e.system === JUDGE ? '是' : REPLY, usage } }))
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  expect(seen.files).toEqual(['/home/t/.claude/flowmap/vscode-42-offer.html', '/home/t/.claude/flowmap/vscode-42-offer.json'])
})

test('開對話時快轉拉取 mods repo，有更新才提示', async ($, on) => {
  const argv: string[][] = []
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/home/t' }))
  let head = 'aaa'
  on('process.run', (_$, e) => {
    argv.push([...e.argv])
    if (e.argv.includes('pull')) head = 'bbb'
    return { value: { exitCode: 0, stdout: e.argv.includes('rev-parse') ? `${head}\n` : '', stderr: '' } as never }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined } as never
  })
  await $.session.start({ source: 'startup', cwd: '/home/t' } as never)
  await clock.advance(1)
  expect(argv.map(a => a.slice(3).join(' '))).toEqual(['rev-parse HEAD', 'pull --ff-only --quiet', 'rev-parse HEAD'])
  expect(toasts.length).toBe(1)
})

const show = (line: FlowLine) =>
  `${'  '.repeat(line.indent)}${line.branch === '' ? '' : `${line.branch}：`}${
    line.kind === 'node' ? line.node.label : line.kind === 'jump' ? `接到「${line.label}」` : '繼續往下'
  }`

test('面板大綱每個節點只畫一次，分支匯流後回到外層，不重複標接到', () => {
  const parsed = parseReply([
    '摘要：env-hint 未在遠端生效。',
    '```mermaid',
    'flowchart TD',
    '  A["看不到 env-hint"]:::start --> B["原因：遠端執行"]:::warn --> F{"連線仍在?"}:::decide',
    '  F -->|是| G["兩台 git pull"]:::step --> H["改 settings.json"]:::step --> J["重開對話"]:::step',
    '  F -->|否| I["使用者自行處理"]:::warn --> J',
    '  J --> L["讀到 env-hint"]:::done',
    '  K["Mac 也要重開"]:::warn --> L',
    '```',
  ].join('\n'))
  expect(outlineFlow(parsed?.nodes ?? [], parsed?.edges ?? []).map(show)).toEqual([
    '看不到 env-hint',
    '原因：遠端執行',
    '連線仍在?',
    '  是：兩台 git pull',
    '  改 settings.json',
    '  否：使用者自行處理',
    '重開對話',
    '讀到 env-hint',
    'Mac 也要重開',
    '接到「讀到 env-hint」',
  ])
})

test('主線留在外層繼續畫，終止或回頭的分支縮排在判斷底下', () => {
  const parsed = parseReply([
    '摘要：安裝流程。',
    '```mermaid',
    'flowchart TD',
    '  A{"連線結果?"}:::decide',
    '  A -->|逾時| B["手動安裝"]:::warn',
    '  A -->|要密碼| C["設定金鑰"]:::warn --> A',
    '  A -->|成功| D{"mods 在哪?"}:::decide',
    '  D -->|預設路徑| P1["git pull"]:::step --> E',
    '  D -->|沒有| P2["git clone"]:::step --> E',
    '  E{"快轉成功?"}:::decide',
    '  E -->|否| W["請使用者處理"]:::warn --> D',
    '  E -->|是| S["改設定"]:::step --> Z["完成"]:::done',
    '```',
  ].join('\n'))
  expect(outlineFlow(parsed?.nodes ?? [], parsed?.edges ?? []).map(show)).toEqual([
    '連線結果?',
    '  逾時：手動安裝',
    '  要密碼：設定金鑰',
    '  接到「連線結果?」',
    '  成功：繼續往下',
    'mods 在哪?',
    '  預設路徑：git pull',
    '  沒有：git clone',
    '快轉成功?',
    '  否：請使用者處理',
    '  接到「mods 在哪?」',
    '  是：繼續往下',
    '改設定',
    '完成',
  ])
})

test('巢狀判斷：匯流點還有外層的邊連入時交給外層畫', () => {
  const nodes = ['O', 'I', 'X', 'Y', 'Z', 'M', 'END'].map(id => ({ id, label: id, kind: 'step' }))
  const edges = [
    { from: 'O', to: 'I', label: '是' },
    { from: 'O', to: 'Z', label: '否' },
    { from: 'I', to: 'X', label: 'a' },
    { from: 'I', to: 'Y', label: 'b' },
    { from: 'X', to: 'M', label: '' },
    { from: 'Y', to: 'M', label: '' },
    { from: 'Z', to: 'M', label: '' },
    { from: 'M', to: 'END', label: '' },
  ]
  expect(outlineFlow(nodes, edges).map(show)).toEqual([
    'O',
    '  是：I',
    '    a：X',
    '    接到「M」',
    '    b：Y',
    '    接到「M」',
    '  否：Z',
    'M',
    'END',
  ])
})

const INSTALL = [
  '摘要：安裝流程。',
  '```mermaid',
  'flowchart TD',
  '  A{"連線結果?"}:::decide',
  '  A -->|逾時| B["手動安裝"]:::warn',
  '  A -->|要密碼| C["設定金鑰"]:::warn --> A',
  '  A -->|成功| D{"mods 在哪?"}:::decide',
  '  D -->|預設路徑| P1["git pull"]:::step --> E',
  '  D -->|沒有| P2["git clone"]:::step --> E',
  '  E{"快轉成功?"}:::decide',
  '  E -->|否| W["請使用者處理"]:::warn --> D',
  '  E -->|是| S["改設定"]:::step --> Z["完成"]:::done',
  '```',
].join('\n')

test('SVG 流程圖：同一層節點不重疊，主線排成一直線，迴圈改成「回到」標籤', () => {
  const parsed = parseReply(INSTALL)
  const layout = layoutFlow(parsed?.nodes ?? [], parsed?.edges ?? [])
  const real = [...layout.items.values()].filter(item => item.node)
  for (const a of real) {
    for (const b of real) {
      if (a === b || a.rank !== b.rank) continue
      expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2).toBe(true)
    }
  }
  const x = (id: string) => layout.items.get(id)?.x
  expect(new Set([x('A'), x('D'), x('E'), x('S'), x('Z')]).size).toBe(1)
  expect(layout.chains.every(chain => (layout.items.get(chain.ids[0] ?? '')?.rank ?? 0) < (layout.items.get(chain.ids.at(-1) ?? '')?.rank ?? 0))).toBe(true)
  const svg = flowSvg(parsed?.nodes ?? [], parsed?.edges ?? [])
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('回到「連線結果?」')
  expect(svg).toContain('回到「mods')
  for (const label of ['連線結果?', '手動安裝', 'git clone', '完成', '逾時', '是']) expect(svg).toContain(label)
})

test('SVG 流程圖：特殊字元會跳脫，32 個節點仍在 Svg 長度上限內', () => {
  const nodes = Array.from({ length: 32 }, (_, i) => ({ id: `N${i}`, label: `步驟 ${i} <a & "b">`, kind: i % 5 === 0 ? 'decide' : 'step' }))
  const edges = nodes.slice(1).map((node, i) => ({ from: `N${i}`, to: node.id, label: i % 5 === 0 ? '是' : '' }))
  const svg = flowSvg(nodes, edges)
  expect(svg).toContain('步驟 0 &lt;')
  expect(svg).toContain('a &amp; &quot;b&quot;&gt;')
  expect(svg).not.toContain('<a &')
  expect(svg.length).toBeLessThan(131072)
})

test('標籤折行時各行寬度平均，不留下單獨一個字', () => {
  expect(wrapLabel('出現彩色提示即完成')).toEqual(['出現彩色提', '示即完成'])
  expect(wrapLabel('短標籤')).toEqual(['短標籤'])
  expect(wrapLabel('請使用者 ssh-copy-id')).toEqual(['請使用者', 'ssh-copy-id'])
  expect(wrapLabel('步驟4 備份 settings.json')).toEqual(['步驟4 備份', 'settings.json'])
})

test('面板：桌面版畫 SVG 流程圖，終端機畫縮排大綱', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen, INSTALL)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  const desktop = await $.ui.mount({ plugin: 'flowmap', surface: 'desktop', component: 'Pane', requestId: 'flowmap', props: {} as never })
  const svg = await desktop.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('回到「連線結果?」')
  expect(String(svg?.props.alt)).toContain('安裝流程。')
  const terminal = await $.ui.mount({ plugin: 'flowmap', surface: 'terminal', component: 'Pane', requestId: 'flowmap', props: {} as never })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: '繼續往下' })).toBeDefined()
})

test('面板工具列：上一張、下一張與縮放', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const clock = setup(on, seen, INSTALL)
  for (const text of ['步驟', '流程']) {
    await $.turn.complete(answer(text.repeat(400)))
    await clock.advance(1)
    await clock.advance(1)
    await look($)
  }
  const pane = await $.ui.mount({ plugin: 'flowmap', surface: 'desktop', component: 'Pane', requestId: 'flowmap', props: {} as never })
  expect(await pane.find({ type: 'Text', text: '2 / 2' })).toBeDefined()
  await pane.press({ key: 'flowmap-prev' })
  expect(await pane.find({ type: 'Text', text: '1 / 2' })).toBeDefined()
  await pane.press({ key: 'flowmap-prev' })
  expect(await pane.find({ type: 'Text', text: '1 / 2' })).toBeDefined()
  await pane.press({ key: 'flowmap-next' })
  expect(await pane.find({ type: 'Text', text: '2 / 2' })).toBeDefined()
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBeUndefined()
  await pane.press({ key: 'flowmap-zoom-in' })
  expect(await pane.find({ type: 'Text', text: '125%' })).toBeDefined()
  expect(Number((await pane.find({ type: 'Svg' }))?.props.width)).toBeGreaterThan(0)
  const terminal = await $.ui.mount({ plugin: 'flowmap', surface: 'terminal', component: 'Pane', requestId: 'flowmap', props: {} as never })
  expect(await terminal.find({ type: 'Button', key: 'flowmap-prev' })).toBeDefined()
  expect(await terminal.find({ type: 'Button', key: 'flowmap-zoom-in' })).toBeUndefined()
})

const SEQUENCE = [
  'sequenceDiagram',
  '  participant U as 使用者',
  '  actor D as 桌面版',
  '  U->>D: 開新對話',
  '  D->>+C: 啟動',
  '  C->>C: 載入 mod',
  '  Note over C,D: 背景拉取 <更新>',
  '  alt 有新版',
  '    C-->>D: 顯示已更新',
  '  else 有未推送提交',
  '    C--xD: 跳過',
  '  end',
  '  rect rgb(0,0,0)',
  '    loop 每則回應',
  '      C-)U: 詢問要不要看',
  '    end',
  '  end',
].join('\n')

test('時序圖：解析參與者、各種箭頭、註記與巢狀區塊', () => {
  const parsed = parseSequence(SEQUENCE)
  expect(parsed?.parties.map(p => `${p.id}:${p.label}:${p.isActor}`)).toEqual(['U:使用者:false', 'D:桌面版:true', 'C:C:false'])
  const kinds = parsed?.steps.map(step => (step.kind === 'msg' ? `${step.from}>${step.to}:${step.head}:${step.isDashed}` : step.kind))
  expect(kinds).toEqual(['U>D:arrow:false', 'D>C:arrow:false', 'C>C:arrow:false', 'note', 'open', 'C>D:arrow:true', 'else', 'C>D:cross:true', 'end', 'open', 'C>U:open:false', 'end'])
  const svg = drawSequence(SEQUENCE)?.source ?? ''
  expect(svg.startsWith('<svg')).toBe(true)
  for (const text of ['使用者', '桌面版', '開新對話', '條件', '[有新版]', '[有未推送提交]', '重複', '背景拉取 &lt;更新&gt;']) expect(svg).toContain(text)
  expect(drawSequence('sequenceDiagram\n  participant A')).toBeNull()
})

const TIMELINE = [
  'timeline',
  '  title 修改歷程',
  '  section 11 月 6 日',
  '    17:25 開始 : 狀態列版本 : 頁尾標籤失敗',
  '    : 改在輸入框上方',
  '  section 11 月 9 日',
  '    10:30 : 時序圖與時間軸',
  '    2026-12:之後再說',
  '    只有時期',
].join('\n')

test('時間軸：時期、事件、接續行、分段與沒有空白的冒號', () => {
  const parsed = parseTimeline(TIMELINE)
  expect(parsed?.title).toBe('修改歷程')
  expect(parsed?.sections).toEqual(['11 月 6 日', '11 月 9 日'])
  expect(parsed?.periods.map(p => `${p.section}|${p.label}|${p.events.join('/')}`)).toEqual([
    '0|17:25 開始|狀態列版本/頁尾標籤失敗/改在輸入框上方',
    '1|10:30|時序圖與時間軸',
    '1|2026-12|之後再說',
    '1|只有時期|',
  ])
  const svg = drawTimeline(TIMELINE)?.source ?? ''
  for (const text of ['修改歷程', '11 月 6 日', '17:25 開始', '改在輸入框上方', '之後再說']) expect(svg).toContain(text)
  expect(drawTimeline('timeline\n  title 空的')).toBeNull()
})

test('面板：桌面版把時序圖畫成 SVG，不支援的種類列大綱', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const reply = '摘要：開對話時的更新流程。\n```mermaid\n' + SEQUENCE + '\n```'
  const clock = setup(on, seen, reply)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  const pane = await $.ui.mount({ plugin: 'flowmap', surface: 'desktop', component: 'Pane', requestId: 'flowmap', props: {} as never })
  const svg = await pane.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('開新對話')
  expect(String(svg?.props.alt)).toContain('時序圖')
})

test('面板：桌面版遇到還不會畫的種類改列大綱', async ($, on) => {
  const seen: Seen = { prompts: [], argv: [], files: [], judged: 0, verdict: '是' }
  const reply = '摘要：資料表。\n```mermaid\nerDiagram\n  USER ||--o{ ORDER : places\n```'
  const clock = setup(on, seen, reply)
  await $.turn.complete(answer('步驟'.repeat(400)))
  await clock.advance(1)
  await clock.advance(1)
  await look($)
  const pane = await $.ui.mount({ plugin: 'flowmap', surface: 'desktop', component: 'Pane', requestId: 'flowmap', props: {} as never })
  expect(await pane.find({ type: 'Svg' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '資料表關聯圖的大綱' })).toBeDefined()
})
