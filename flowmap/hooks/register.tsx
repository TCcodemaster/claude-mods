import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { FlowMap, FlowView } from '../types'
import { buildHtml, checkFlow, findPane, JUDGE, mermaidForImage, parseReply, parseSurface, renderScript, SYSTEM, TERMINAL_COLORS, toDataUrl } from './flow'
import type { Parsed } from './flow'

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
// 提示框上方的按鈕依這個狀態決定要顯示「隱藏」還是「畫這則」。
const view = atom({ plugin: 'flowmap', key: 'view' } as const, null)

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
// 已經開著的窗格不用 navigate 換網址（cmux 會把 data URL 當成搜尋字詞），
// 改用 browser.eval 呼叫頁面內建的換圖函式。
async function showInCmux($: EngineInterface, html: string, script: string): Promise<void> {
  // 不在 cmux 裡就不開任何瀏覽器，圖只留在 /flow 面板。
  if (!(await $.env.get('CMUX_WORKSPACE_ID'))) return
  const cmux = (await $.env.get('CMUX_BUNDLED_CLI_PATH')) ?? 'cmux'

  // 記住的窗格只在這個工作階段有效；重開 Claude Code 或另開對話時，改找工作區裡已經開著的圖解分頁。
  const swap = async (surface: string): Promise<boolean> => {
    // 遠端版 cmux 的 browser 子指令不收窗格參數，換圖改走兩邊都支援的 rpc。
    const swapped = await $.process.run([cmux, 'rpc', 'browser.eval', JSON.stringify({ surface_id: surface, script })])
    return swapped.exitCode === 0 && swapped.stdout.includes('flowmap-ok')
  }
  const current = await read($, browser)
  if (current && (await swap(current))) return
  const listed = await $.process.run([cmux, '--json', 'list-panels'])
  const found = listed.exitCode === 0 ? findPane(listed.stdout) : null
  if (found && found !== current && (await swap(found))) {
    await update($, browser, () => found)
    return
  }
  const opened = await $.process.run([cmux, 'browser', 'open-split', toDataUrl(html)])
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
// 網頁給第一次開啟用；之後檢視器讀 json，用 postMessage 換圖，頁面保留上一張、下一張的紀錄。
async function showInViewer($: EngineInterface, html: string, data: { summary: string; mermaid: string; stamp: string }, suffix = ''): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home) return false
  const installed = await $.fs
    .list(`${home}/.vscode/extensions`)
    .then(entries => entries.some(entry => entry.name.startsWith('tccodemaster.flowmap-viewer-')))
    .catch(() => false)
  if (!installed) return false
  const pid = (await $.env.get('VSCODE_PID')) ?? 'default'
  await $.fs.write(`${home}/.claude/flowmap/vscode-${pid}${suffix}.html`, html)
  await $.fs.write(`${home}/.claude/flowmap/vscode-${pid}${suffix}.json`, JSON.stringify({ type: 'flowmap', ...data }))
  return true
}

async function isVSCode($: EngineInterface): Promise<boolean> {
  return (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-vscode' || (await $.env.get('TERM_PROGRAM')) === 'vscode'
}

// 畫圖不用 fork：fork 沿用對話的 effort，主模型想很久。改用 Opus 低 effort 只看回應原文，
// 用 claude -p 量同一則回應（含啟動時間）：Opus 高 effort 約 19 秒，低 effort 約 8 秒。
async function draw($: EngineInterface, extra: string): Promise<Parsed | string> {
  const reply = await $.model.complete({
    model: 'opus',
    effort: 'low',
    system: SYSTEM,
    prompt: `<回應>\n${(await read($, lastAnswer)).slice(0, 20000)}\n</回應>\n\n請把這則回應整理成一張 Mermaid 圖。${extra}`,
    timeoutMs: 60000,
  })
  if (!reply.isAnswered) return `圖解產生失敗：${reply.reason}`
  return parseReply(reply.text) ?? '圖解產生失敗：模型沒有回傳 Mermaid 圖'
}

// 只更新同一則回應的狀態，避免舊回應的結果蓋掉新回應。
async function setView($: EngineInterface, turn: number, state: FlowView['state']): Promise<void> {
  await update($, view, current => (current && current.turn !== turn ? current : { turn, state }))
}

// 把圖送到外部檢視器（cmux 瀏覽器窗格或 VS Code）；有送出去就回傳 true。
async function display($: EngineInterface, shown: FlowMap): Promise<boolean> {
  if (!(await read($, isWeb))) return false
  const inCmux = Boolean(await $.env.get('CMUX_WORKSPACE_ID'))
  const stamp = new Date(shown.at).toLocaleString('zh-TW', { hour12: false })
  const html = buildHtml(shown.summary, shown.mermaid, stamp)
  const script = renderScript(shown.summary, shown.mermaid, stamp)
  if (!inCmux && (await isVSCode($))) {
    const data = { summary: shown.summary.replace(/^摘要[:：]\s*/, ''), mermaid: shown.mermaid, stamp }
    if (await showInViewer($, html, data)) return true
    if (await showInVSCode($, mermaidForImage(shown.summary, shown.mermaid, shown.diagram))) return true
    return false
  }
  await showInCmux($, html, script)
  return inCmux
}

// 正在產生的回應，避免同一則重複請模型畫。
const drawing = new Set<number>()

async function reveal($: EngineInterface, shown: FlowMap): Promise<void> {
  await setView($, shown.turn, 'shown')
  if (!(await display($, shown))) await $.ui.open({ id: PANE, title: TITLE })
}

// 收起圖解：關掉終端機面板，cmux 裡一併關掉瀏覽器窗格，按鈕回到詢問狀態。
async function hide($: EngineInterface, turn: number): Promise<void> {
  await setView($, turn, 'offer')
  await $.ui.close({ id: PANE })
  const surface = await read($, browser)
  if (!surface || !(await $.env.get('CMUX_WORKSPACE_ID'))) return
  const cmux = (await $.env.get('CMUX_BUNDLED_CLI_PATH')) ?? 'cmux'
  // 遠端版 cmux 不一定有 close-surface 子指令，改走兩邊都支援的 rpc。
  await $.process.run([cmux, 'rpc', 'surface.close', JSON.stringify({ workspace_id: await $.env.get('CMUX_WORKSPACE_ID'), surface_id: surface })])
  await update($, browser, () => null)
}

// 看圖解：背景已經畫好就直接顯示，還沒畫好就等產生完自動顯示。
async function show($: EngineInterface, turn: number): Promise<void> {
  const current = await read($, map)
  if (current?.turn === turn) {
    await reveal($, current)
    return
  }
  await setView($, turn, 'wanted')
  await generate($, turn)
}

async function generate($: EngineInterface, turn: number): Promise<void> {
  if (drawing.has(turn)) return
  drawing.add(turn)
  await update($, isBusy, () => true)
  let parsed = await draw($, '')
  // 檢查出問題就把問題清單交回去重畫一次；第二次還有問題就照用。
  const problems = typeof parsed === 'string' ? [] : checkFlow(parsed)
  if (typeof parsed !== 'string' && problems.length > 0) {
    const retry = await draw(
      $,
      `\n\n你剛才畫的圖：\n\`\`\`mermaid\n${parsed.mermaid}\n\`\`\`\n\n有以下問題，請修正後重畫：\n${problems.map(p => `- ${p}`).join('\n')}`,
    )
    if (typeof retry !== 'string') parsed = retry
  }
  await update($, isBusy, () => false)
  drawing.delete(turn)
  const latest = await read($, view)
  const isWanted = latest?.turn === turn && latest.state === 'wanted'
  if (typeof parsed === 'string') {
    if (isWanted) {
      await setView($, turn, 'offer')
      $.ui.toast(parsed)
    }
    return
  }
  const at = await $.clock.now()
  const next: FlowMap = { ...parsed, at, turn }
  await update($, map, () => next)
  // 預設不顯示，只有使用者按了「看圖解」才送出去。
  if (isWanted) await reveal($, next)
  else await offerInVSCode($, next)
}

// VS Code 擴充套件沒有提示框上方的位置，改寫出 -offer 檔，由 flowmap-viewer 跳出原生通知詢問要不要看。
async function offerInVSCode($: EngineInterface, drawn: FlowMap): Promise<void> {
  if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-vscode' || !(await read($, isWeb))) return
  const stamp = new Date(drawn.at).toLocaleString('zh-TW', { hour12: false })
  const data = { summary: drawn.summary.replace(/^摘要[:：]\s*/, ''), mermaid: drawn.mermaid, stamp }
  await showInViewer($, buildHtml(drawn.summary, drawn.mermaid, stamp), data, '-offer')
}

function isCardShown(current: FlowView | null): current is FlowView {
  return current !== null && current.state !== 'judging' && current.state !== 'skipped'
}

// 圓角卡片：左邊標籤，右邊問句與按鈕。按鈕帶數字快捷鍵，提示框是空的時候直接按 1、2 就能選。
function drawCard($: EngineInterface, ui: Pick<Elements['vscode'], 'Box' | 'Button' | 'Text'>, current: FlowView) {
  const { Box, Button, Text } = ui
  const turn = current.turn
  const message = {
    offer: '要看這則回應的圖解嗎？',
    wanted: '圖解產生中，完成後會自動打開。',
    shown: '圖解已經打開在右側。',
  }[current.state as 'offer' | 'wanted' | 'shown']
  const actions =
    current.state === 'shown'
      ? [{ key: 'flowmap-hide', label: '收起', run: () => hide($, turn) }]
      : current.state === 'wanted'
        ? [{ key: 'flowmap-cancel', label: '取消', run: () => setView($, turn, 'offer') }]
        : [
            { key: 'flowmap-show', label: '看圖解', run: () => show($, turn) },
            { key: 'flowmap-dismiss', label: '不用', run: () => setView($, turn, 'skipped') },
          ]
  return (
    <Box borderStyle="round" borderColor={TERMINAL_COLORS.start} paddingX={1} gap={2} alignSelf="flex-start">
      <Text color={TERMINAL_COLORS.start} bold>
        ◆ 圖解
      </Text>
      <Box flexDirection="column">
        <Text>{message}</Text>
        <Box gap={1}>
          {actions.flatMap((action, i) => [
            ...(i > 0 ? [<Text dimColor>·</Text>] : []),
            <Button key={action.key} label={action.label} hotkey={String(i + 1)} plain onPress={action.run} />,
          ])}
        </Box>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: '圖解：/flow 畫上一則並打開；/flow hide 收起；/flow on|off 自動產生；/flow web on|off 瀏覽器窗格',
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
    if ((await read($, lastAnswer)) === '') return { text: '目前還沒有可以整理的回應。' }
    const turn = (await read($, view))?.turn ?? (await $.clock.now())
    $.clock.after(0, () => {
      void show($, turn)
    })

    return { text: '正在重畫上一則回應的流程圖。' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer' || !e.answer) return result
    await update($, lastAnswer, () => e.answer)
    const turn = await $.clock.now()
    // 太短的回應不出現按鈕，要畫還是可以輸入 /flow。
    if (e.answer.length < MIN_CHARS) {
      await update($, view, () => null)
      return result
    }
    // 自動模式先由 Haiku 判斷，值得畫才詢問並在背景先畫好；關閉時每則長回應都直接詢問。
    if (!(await read($, isAuto))) {
      await update($, view, () => ({ turn, state: 'offer' as const }))
      return result
    }
    await update($, view, () => ({ turn, state: 'judging' as const }))
    const answer = e.answer
    // 判斷與產生都交給計時器跑，不卡住回合結束。
    $.clock.after(0, () => {
      void (async () => {
        if (!(await isWorthDrawing($, answer))) {
          await update($, view, (current): FlowView | null => (current?.turn === turn && current.state === 'judging' ? { turn, state: 'skipped' } : current))
          return
        }
        await update($, view, (current): FlowView | null => (current?.turn === turn && current.state === 'judging' ? { turn, state: 'offer' } : current))
        await generate($, turn)
      })()
    })

    return result
  })

  // 終端機（含 SSH 與 VS Code 內建終端機）與桌機版畫在提示框上方。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, view)
    // 新的回合在跑時先收起，等回應結束再換成新的一則。
    if (e.props.hasSurvey || e.props.isWorking || !isCardShown(current)) return next(e)
    return drawCard($, $.ui.resolve(e), current)
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
