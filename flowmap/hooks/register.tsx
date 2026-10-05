import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlowMap } from '../types'
import { buildHtml, JUDGE, mermaidForImage, parseReply, parseSurface, SYSTEM, TERMINAL_COLORS, toDataUrl } from './flow'

const PANE = 'flowmap'
const TITLE = '圖解'
const map = atom({ plugin: 'flowmap', key: 'map' } as const, null)
const isBusy = atom({ plugin: 'flowmap', key: 'isBusy' } as const, false)
const isAuto = atom({ plugin: 'flowmap', key: 'isAuto' } as const, true)
const isWeb = atom({ plugin: 'flowmap', key: 'isWeb' } as const, true)
const DIAGRAM_NAMES: Record<string, string> = {
  mindmap: '心智圖',
  sequenceDiagram: '時序圖',
  'stateDiagram-v2': '狀態圖',
  stateDiagram: '狀態圖',
  timeline: '時間軸',
  quadrantChart: '象限圖',
  erDiagram: '資料表關聯圖',
}
const browser = atom({ plugin: 'flowmap', key: 'browser' } as const, null)
// 存在對話狀態裡，mod 重新載入後 /flow 仍找得到上一則回應。
const lastAnswer = atom({ plugin: 'flowmap', key: 'lastAnswer' } as const, '')

// 太短的回應直接略過，不必花一次 Haiku 判斷。
const MIN_CHARS = 300

// 由 Haiku 依內容判斷值不值得畫圖，只回答「是」或「否」。
async function isWorthDrawing($: EngineInterface, answer: string): Promise<boolean> {
  if (answer.length < MIN_CHARS) return false
  const reply = await $.model.complete({
    model: 'haiku',
    system: JUDGE,
    prompt: `<回應>\n${answer.slice(0, 12000)}\n</回應>\n\n這則回應值得附一張示意圖嗎？只回答「是」或「否」。`,
    maxTokens: 8,
    effort: 'low',
    timeoutMs: 15000,
  })
  return reply.isAnswered && reply.text.trim().startsWith('是')
}

// 把頁面送進 cmux 的瀏覽器窗格；窗格被關掉就重開一個。
// 頁面直接編進 data URL，不寫檔：SSH 到遠端時，本機的 cmux 瀏覽器讀不到伺服器上的檔案。
// 只用本機版與遠端版 cmux 都認得的參數，輸出則兩種格式都接受。
async function showInCmux($: EngineInterface, html: string): Promise<void> {
  // 不在 cmux 裡就不開任何瀏覽器，圖只留在 /flow 面板。
  if (!(await $.env.get('CMUX_WORKSPACE_ID'))) return
  const cmux = (await $.env.get('CMUX_BUNDLED_CLI_PATH')) ?? 'cmux'
  const url = toDataUrl(html)

  const current = await read($, browser)
  if (current) {
    const moved = await $.process.run([cmux, 'browser', current, 'navigate', url])
    if (moved.exitCode === 0) return
  }
  const opened = await $.process.run([cmux, 'browser', 'open-split', url])
  const surface = parseSurface(opened.stdout)
  if (opened.exitCode !== 0 || !surface) {
    $.ui.toast(`圖解：無法開啟 cmux 瀏覽器窗格（${(opened.stderr || opened.stdout).trim() || opened.exitCode}）`)
    return
  }
  await update($, browser, () => surface)
}

const CODE_CLI = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 在 VS Code 裡（擴充套件或內建終端機）：用 mermaid-cli 借 Chrome 渲染成 PNG，
// 再用 VS Code 的圖片檢視器打開。檔名固定，已開著的分頁會自動換成新圖。
// 少了 mermaid-cli 或 Chrome 就回傳 false。
async function showInVSCode($: EngineInterface, source: string): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home) return false
  const dir = `${home}/.claude/flowmap`
  await $.fs.write(`${dir}/latest.mmd`, source)
  await $.fs.write(`${dir}/puppeteer.json`, JSON.stringify({ executablePath: CHROME, headless: 'new' }))
  // VS Code 擴充套件的 PATH 可能沒有 Homebrew，mermaid-cli 需要找得到 node。
  const path = `/opt/homebrew/bin:/usr/local/bin:${(await $.env.get('PATH')) ?? '/usr/bin:/bin'}`
  try {
    const drawn = await $.process.run(
      ['mmdc', '-q', '-p', `${dir}/puppeteer.json`, '-i', `${dir}/latest.mmd`, '-o', `${dir}/latest.png`, '-s', '2', '-b', 'white'],
      { env: { PATH: path }, timeoutMs: 60000 },
    )
    if (drawn.exitCode !== 0) return false
    const opened = await $.process.run([CODE_CLI, '-r', `${dir}/latest.png`], { env: { PATH: path } })
    return opened.exitCode === 0
  } catch {
    return false
  }
}

// 裝了 vscode-viewer 擴充套件時，寫出網頁讓它在旁邊一欄顯示，不需要 Chrome。
async function showInViewer($: EngineInterface, html: string): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home) return false
  const installed = await $.fs
    .list(`${home}/.vscode/extensions`)
    .then(entries => entries.some(entry => entry.name.startsWith('tccodemaster.flowmap-viewer-')))
    .catch(() => false)
  if (!installed) return false
  const pid = (await $.env.get('VSCODE_PID')) ?? 'default'
  await $.fs.write(`${home}/.claude/flowmap/vscode-${pid}.html`, html)
  return true
}

async function isVSCode($: EngineInterface): Promise<boolean> {
  return (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-vscode' || (await $.env.get('TERM_PROGRAM')) === 'vscode'
}

async function generate($: EngineInterface, answer: string): Promise<void> {
  await update($, isBusy, () => true)
  const reply = await $.model.complete({
    model: 'haiku',
    system: SYSTEM,
    prompt: `請整理以下回應：\n\n${answer.slice(0, 20000)}`,
    maxTokens: 2048,
    timeoutMs: 60000,
  })
  await update($, isBusy, () => false)
  if (!reply.isAnswered) {
    $.ui.toast(`圖解產生失敗：${reply.reason}`)
    return
  }
  const parsed = parseReply(reply.text)
  if (!parsed) {
    $.ui.toast('圖解產生失敗：模型沒有回傳 Mermaid 圖')
    return
  }
  const at = await $.clock.now()
  const next: FlowMap = { ...parsed, at }
  await update($, map, () => next)
  if (await read($, isWeb)) {
    const inCmux = Boolean(await $.env.get('CMUX_WORKSPACE_ID'))
    const stamp = new Date(at).toLocaleString('zh-TW', { hour12: false })
    const html = buildHtml(parsed.summary, parsed.mermaid, stamp)
    if (!inCmux && (await isVSCode($))) {
      if (await showInViewer($, html)) return
      if (await showInVSCode($, mermaidForImage(parsed.summary, parsed.mermaid, parsed.diagram))) return
    }
    await showInCmux($, html)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: '圖解：/flow 重畫上一則；/flow hide 收起；/flow on|off 自動產生；/flow web on|off 瀏覽器窗格',
    })
    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await update($, isAuto, () => arg === 'on')
      return { text: arg === 'on' ? '已開啟自動產生流程圖。' : '已關閉自動產生流程圖。' }
    }
    if (arg === 'web on' || arg === 'web off') {
      await update($, isWeb, () => arg === 'web on')
      return { text: arg === 'web on' ? '流程圖會顯示在 cmux 瀏覽器窗格。' : '流程圖只顯示在終端機面板。' }
    }
    if (arg === 'hide') {
      await $.ui.close({ id: PANE })
      return { text: '已收起圖解面板，輸入 /flow 可再打開。' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    const answer = await read($, lastAnswer)
    if (answer === '') return { text: '目前還沒有可以整理的回應。' }
    $.clock.after(0, () => {
      void generate($, answer)
    })

    return { text: '正在重畫上一則回應的流程圖。' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer' || !e.answer) return result
    await update($, lastAnswer, () => e.answer)
    if (await read($, isAuto)) {
      const answer = e.answer
      // 判斷與產生都交給計時器跑，不卡住回合結束。
      $.clock.after(0, () => {
        void (async () => {
          if (await isWorthDrawing($, answer)) await generate($, answer)
        })()
      })
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, map)
    const busy = await read($, isBusy)
    const auto = await read($, isAuto)

    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>
            {busy ? '流程圖產生中，請稍候。' : auto ? '長回應結束後會自動產生流程圖。' : '自動產生已關閉，輸入 /flow 手動產生。'}
          </Text>
        </Box>
      )
    }

    if (current.diagram !== 'flowchart') {
      return (
        <Box flexDirection="column">
          {busy && <Text dimColor>更新中…</Text>}
          <Text bold>{current.summary.replace(/^摘要[:：]\s*/, '')}</Text>
          <Text dimColor>{`${DIAGRAM_NAMES[current.diagram] ?? current.diagram}，完整圖在 cmux 瀏覽器窗格`}</Text>
          <Text> </Text>
          {current.outline.map((line, i) => (
            <Text wrap="truncate-end" color={i === 0 ? TERMINAL_COLORS.start : undefined} bold={!line.startsWith(' ')}>
              {line}
            </Text>
          ))}
        </Box>
      )
    }

    const order = current.nodes.map(node => node.id)
    const labelOf = new Map(current.nodes.map(node => [node.id, node.label]))
    return (
      <Box flexDirection="column">
        {busy && <Text dimColor>更新中…</Text>}
        <Text bold>{current.summary.replace(/^摘要[:：]\s*/, '')}</Text>
        <Text> </Text>
        {current.nodes.map((node, i) => {
          const outs = current.edges.filter(edge => edge.from === node.id)
          const isStraight = outs.length === 1 && outs[0]?.label === '' && outs[0]?.to === order[i + 1]
          return (
            <Box flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={TERMINAL_COLORS[node.kind] ?? 'claude'}>{node.kind === 'decide' ? '◆ ' : '■ '}</Text>
                <Text bold={node.kind !== 'step'}>{node.label}</Text>
              </Text>
              {isStraight && <Text dimColor>│</Text>}
              {!isStraight &&
                outs.map(edge => (
                  <Text wrap="truncate-end">
                    <Text dimColor>├▶ </Text>
                    {edge.label !== '' && <Text color={TERMINAL_COLORS.decide}>{edge.label} </Text>}
                    <Text dimColor>{labelOf.get(edge.to) ?? edge.to}</Text>
                  </Text>
                ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
