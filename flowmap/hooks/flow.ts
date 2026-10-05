import type { FlowEdge, FlowNode } from '../types'

export const KINDS = ['start', 'step', 'decide', 'done', 'warn'] as const

// 終端機用主題色，跟著 Claude Code 的淺色或深色主題走。
export const TERMINAL_COLORS: Record<string, string> = {
  start: 'suggestion',
  step: 'claude',
  decide: 'warning',
  done: 'success',
  warn: 'error',
}

export const JUDGE = [
  '你是分類器。使用者會給你一則 AI 助理寫的回應原文，包在 <回應> 標籤裡。',
  '你要判斷：如果在這則回應旁邊另外附一張示意圖（流程圖、架構圖、時序圖之類），能不能明顯幫助讀者理解。',
  '只輸出一個字：「是」或「否」。不要輸出其他任何文字，不要要求更多資料。',
  '輸出「是」只限這些情況：',
  '- 有三個以上有先後順序的步驟，或有判斷分支。',
  '- 多個元件、系統或角色之間有互動或資料流向。',
  '- 有明確的架構、層級或分類關係。',
  '- 有狀態轉換，或依時間、階段排列的事件。',
  '- 多個方案在兩個以上面向上做取捨比較。',
  '輸出「否」的情況：',
  '- 回答一個問題、說明原因、給出單一結論或建議。',
  '- 回報做了什麼、測試結果、操作說明只有一兩步。',
  '- 主要在解說程式碼、錯誤訊息或指令輸出。',
  '- 內容已經是清楚的表格，畫圖只是重複。',
  '- 閒聊、道歉、提問，或請使用者做選擇。',
  '拿不準時一律輸出「否」。',
].join('\n')

export const SYSTEM = [
  '你負責把一段技術回應整理成一張最適合的 Mermaid 圖。',
  '輸出格式固定如下，不要加任何其他文字：',
  '第一行：以「摘要：」開頭，用一句完整的繁體中文句子說明重點。',
  '接著是一個 ```mermaid 程式碼區塊。',
  '目的是讓人一眼看懂回應的主軸，不是把所有細節搬上圖。只畫最重要的骨架，細節留在原文。',
  '先依內容挑圖的種類：',
  '- 有先後步驟或判斷分支：flowchart TD。',
  '- 分類、比較、選項整理：flowchart TD 的樹狀圖，根節點在上，每層最多 4 個分支，最多兩層。',
  '- 只有 3 到 5 個並列步驟且沒有分支：flowchart LR 橫向。',
  '- 多個角色或系統之間來回呼叫：sequenceDiagram。',
  '- 狀態之間的轉換：stateDiagram-v2。',
  '- 依時間或階段排列的事件：timeline。',
  '- 兩個維度的比較或優先順序：quadrantChart。',
  '- 資料表與關聯：erDiagram。',
  '- 不要使用 mindmap。',
  '共同規則：文字用繁體中文短句，每個標籤不超過 12 個字；指令、檔名、API 名稱保留原文；整張圖最多 8 個元素；不要寫 style、classDef 或註解。',
  'flowchart 額外規則：',
  '- 節點代號用 A、B、C 這類英文字母，標籤一律加雙引號，例如 A["讀取設定"]。',
  '- 判斷用菱形 {"…?"}，分支邊加標籤，例如 C -->|是| D。',
  '- 每個節點第一次出現時加上類別：:::start 起點、:::step 一般步驟、:::decide 判斷、:::done 結果、:::warn 風險或注意事項。',
  '各種圖的語法範本（照抄結構，不要自創語法）：',
  'sequenceDiagram 範本：\nsequenceDiagram\n  participant A as 使用者\n  participant B as 伺服器\n  A->>B: 送出請求\n  B-->>A: 回傳結果',
  'stateDiagram-v2 範本：\nstateDiagram-v2\n  [*] --> 待處理\n  待處理 --> 處理中: 開始\n  處理中 --> [*]',
  'timeline 範本：\ntimeline\n  title 標題\n  第一階段 : 事件一 : 事件二\n  第二階段 : 事件三',
  'quadrantChart 範本（座標一定要用中括號，數值介於 0 到 1）：\nquadrantChart\n  title 標題\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n  quadrant-1 優先做\n  quadrant-2 值得投資\n  quadrant-3 暫緩\n  quadrant-4 快速見效\n  方案甲: [0.3, 0.6]',
  'erDiagram 範本：\nerDiagram\n  USER ||--o{ ORDER : places\n  USER {\n    int id\n  }',
].join('\n')

export type Parsed = { summary: string; mermaid: string; diagram: string; nodes: FlowNode[]; edges: FlowEdge[]; outline: string[] }

const NODE = /^([A-Za-z_][\w-]*)\s*(\(\[[\s\S]*?\]\)|\[\[[\s\S]*?\]\]|\(\([\s\S]*?\)\)|\[[\s\S]*?\]|\([\s\S]*?\)|\{\{[\s\S]*?\}\}|\{[\s\S]*?\})?\s*(?::::(\w+))?$/
const ARROW = /\s*(?:-->|---|-\.->|==>|-\.-)\s*(?:\|([^|]*)\|\s*)?/

function cleanLabel(shape: string): string {
  return shape
    .replace(/^[\[({]+\/?|\/?[\])}]+$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .trim()
}

// 從模型回覆取出摘要與 Mermaid 原始碼，再解析出節點和邊。
export function parseReply(text: string): Parsed | null {
  const fence = /```mermaid\s*\n([\s\S]*?)```/.exec(text)
  let mermaid = (fence?.[1] ?? '').trim()
  const diagram = /^([\w-]+)/.exec(mermaid)?.[1] ?? ''
  if (diagram === '') return null
  const summaryLine = text.split('\n').find(line => line.trim().startsWith('摘要')) ?? ''
  if (diagram === 'quadrantChart') mermaid = repairQuadrant(mermaid)
  if (diagram !== 'flowchart' && diagram !== 'graph') {
    return { summary: summaryLine.trim(), mermaid, diagram, nodes: [], edges: [], outline: outlineOf(diagram, mermaid) }
  }

  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const byId = new Map<string, FlowNode>()
  const touch = (token: string): string | null => {
    const m = NODE.exec(token.trim())
    if (!m) return null
    const id = m[1] ?? ''
    let node = byId.get(id)
    if (!node) {
      node = { id, label: id, kind: 'step' }
      byId.set(id, node)
      nodes.push(node)
    }
    if (m[2]) node.label = cleanLabel(m[2])
    if (m[3] && (KINDS as readonly string[]).includes(m[3])) node.kind = m[3]
    return id
  }

  for (const raw of mermaid.split('\n').slice(1)) {
    const line = raw.trim().replace(/;$/, '')
    if (line === '' || line.startsWith('%%')) continue
    const cls = /^class\s+([\w,\s-]+?)\s+(\w+)$/.exec(line)
    if (cls) {
      for (const id of (cls[1] ?? '').split(',')) {
        const node = byId.get(id.trim())
        if (node && (KINDS as readonly string[]).includes(cls[2] ?? '')) node.kind = cls[2] ?? node.kind
      }
      continue
    }
    if (/^(classDef|style|subgraph|end|direction|linkStyle)\b/.test(line)) continue
    const parts = line.split(ARROW)
    // split 帶捕獲群組：節點、邊標籤、節點、邊標籤……交錯出現。
    let prev: string | null = touch(parts[0] ?? '')
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const id = touch(parts[i + 1] ?? '')
      if (prev && id) edges.push({ from: prev, to: id, label: (parts[i] ?? '').replace(/^"|"$/g, '').trim() })
      prev = id
    }
  }

  // 用解析結果重寫一份乾淨的 Mermaid，避開模型多打空白或符號造成的語法錯誤。
  // 同一層分支太多時，直向排會太寬；改橫向讓分支上下堆疊，適合窄窗格。
  const fanOut = Math.max(0, ...nodes.map(node => edges.filter(edge => edge.from === node.id).length))
  const asked = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)/.exec(mermaid)?.[1] ?? 'TD'
  const direction = fanOut > 3 ? 'LR' : asked
  const quote = (text: string) => text.replace(/"/g, "'")
  const clean = [
    `flowchart ${direction}`,
    ...nodes.map(node =>
      node.kind === 'decide'
        ? `  ${node.id}{"${quote(node.label)}"}:::decide`
        : `  ${node.id}["${quote(node.label)}"]:::${node.kind}`,
    ),
    ...edges.map(edge => `  ${edge.from} -->${edge.label === '' ? '' : `|"${quote(edge.label)}"|`} ${edge.to}`),
  ].join('\n')
  return { summary: summaryLine.trim(), mermaid: clean, diagram: 'flowchart', nodes, edges, outline: [] }
}

// 模型常把象限圖座標寫成「名稱: 0.3, 0.6」，補成 Mermaid 要求的中括號。
export function repairQuadrant(mermaid: string): string {
  return mermaid
    .split('\n')
    .map(line => line.replace(/^(\s*[^:\[\]]+?):\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/, '$1: [$2, $3]'))
    .join('\n')
}

// 非流程圖給終端機面板的縮排大綱：保留層級，去掉 Mermaid 語法符號。
function outlineOf(diagram: string, mermaid: string): string[] {
  const lines = mermaid.split('\n').slice(1).filter(line => line.trim() !== '' && !line.trim().startsWith('%%'))
  if (diagram === 'mindmap') {
    const base = Math.min(...lines.map(line => line.length - line.trimStart().length))
    return lines.map(line => {
      const depth = Math.round((line.length - line.trimStart().length - base) / 2)
      const label = line.trim().replace(/^[\w-]*\s*[\[({]+"?|"?[\])}]+$/g, '').trim()
      return `${'  '.repeat(depth)}${depth === 0 ? '' : '・'}${label}`
    })
  }
  return lines.map(line => line.trim().replace(/"/g, ''))
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 給 cmux 瀏覽器窗格的頁面；配色依系統深淺色切換。
export function buildHtml(summary: string, mermaid: string, stamp: string): string {
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>圖解</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1f2328; --muted: #6a737d; --card: #ffffff; --line: #e4e1da; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181d; --fg: #e6e6e6; --muted: #9aa4b2; --card: #1e2128; --line: #2c313a; }
  }
  html, body { margin: 0; background: var(--bg); color: var(--fg);
    font: 17px/1.6 -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }
  main { padding: 20px 20px 32px; }
  .summary { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .stamp { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; overflow: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; color: var(--muted); font-size: 14px; }
  .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 3px;
    margin-right: 6px; vertical-align: -1px; background: var(--c); }
  pre.mermaid { margin: 0; text-align: center; }
  pre.mermaid svg { max-width: none !important; height: auto; }
  .zoom { float: right; display: inline-flex; gap: 6px; align-items: center; }
  .zoom button { font: inherit; width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--card); color: var(--fg); cursor: pointer; }
  pre.raw { margin: 0; white-space: pre-wrap; font: 13px/1.6 ui-monospace, Menlo, monospace; }
</style></head>
<body><main>
<p class="summary">${escapeHtml(summary.replace(/^摘要[:：]\s*/, ''))}</p>
<p class="stamp">${escapeHtml(stamp)}<span class="zoom"><button id="zout" title="縮小">－</button><span id="zval">100%</span><button id="zin" title="放大">＋</button></span></p>
<div class="card"><pre class="mermaid" id="src">${escapeHtml(mermaid)}</pre></div>
<div class="legend" id="legend"></div>
</main>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const palette = dark
    ? { start: ['#1d3a5c', '#7cb7ff'], step: ['#2a2f3a', '#aab4c3'], decide: ['#4a3a12', '#f2c14e'],
        done: ['#173d2a', '#5fd38d'], warn: ['#4a1f22', '#ff7b72'] }
    : { start: ['#e3efff', '#2f6fde'], step: ['#f3f4f6', '#8b95a5'], decide: ['#fff4d6', '#d99a00'],
        done: ['#e3f7ea', '#1f9d55'], warn: ['#ffe7e5', '#d63b2f'] }
  const names = { start: '起點', step: '步驟', decide: '判斷', done: '結果', warn: '注意' }
  const src = document.getElementById('src')
  const defs = Object.entries(palette).map(([k, [fill, stroke]]) =>
    'classDef ' + k + ' fill:' + fill + ',stroke:' + stroke + ',stroke-width:2px,color:' + (dark ? '#e6e6e6' : '#1f2328'))
  if (/^(flowchart|graph)\\s/.test(src.textContent.trim())) {
    src.textContent = src.textContent + '\\n' + defs.join('\\n')
    document.getElementById('legend').innerHTML = Object.entries(palette)
      .map(([k, [, stroke]]) => '<span style="--c:' + stroke + '">' + names[k] + '</span>').join('')
  }
  mermaid.initialize({ startOnLoad: false, theme: 'base', darkMode: dark, securityLevel: 'strict',
    flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 36, rankSpacing: 48, useMaxWidth: false },
    sequence: { useMaxWidth: false }, state: { useMaxWidth: false }, timeline: { useMaxWidth: false },
    er: { useMaxWidth: false }, quadrantChart: { useMaxWidth: false }, mindmap: { useMaxWidth: false },
    themeVariables: { fontFamily: '-apple-system, "PingFang TC", sans-serif', fontSize: '22px',
      lineColor: dark ? '#6b7280' : '#9aa1ab', edgeLabelBackground: dark ? '#1e2128' : '#ffffff',
      primaryColor: dark ? '#1d3a5c' : '#e3efff', primaryBorderColor: dark ? '#7cb7ff' : '#2f6fde',
      primaryTextColor: dark ? '#e6e6e6' : '#1f2328', secondaryColor: dark ? '#173d2a' : '#e3f7ea',
      tertiaryColor: dark ? '#4a3a12' : '#fff4d6', actorBkg: dark ? '#1d3a5c' : '#e3efff',
      actorBorder: dark ? '#7cb7ff' : '#2f6fde', noteBkgColor: dark ? '#4a3a12' : '#fff4d6' } })
  // 縮放比例記在這個頁面的瀏覽器儲存裡，下一張圖沿用。
  let scale = 1
  try { scale = Number(localStorage.getItem('flowmap-zoom')) || 1 } catch (e) {}
  // 用 SVG 本身的寬度縮放；CSS zoom 在 WebKit 會切掉節點裡的文字。
  const applyZoom = () => {
    const svg = src.querySelector('svg')
    const box = svg && svg.viewBox && svg.viewBox.baseVal
    if (svg && box && box.width) {
      svg.style.width = Math.round(box.width * scale) + 'px'
      svg.style.height = Math.round(box.height * scale) + 'px'
    }
    document.getElementById('zval').textContent = Math.round(scale * 100) + '%'
    try { localStorage.setItem('flowmap-zoom', String(scale)) } catch (e) {}
  }
  const step = d => { scale = Math.min(2, Math.max(0.5, Math.round((scale + d) * 10) / 10)); applyZoom() }
  document.getElementById('zin').onclick = () => step(0.1)
  document.getElementById('zout').onclick = () => step(-0.1)
  applyZoom()
  const code = src.textContent
  mermaid.parse(code)
    .then(() => mermaid.run({ nodes: [src] }))
    .then(() => applyZoom())
    .catch(err => {
      const card = src.parentElement
      card.innerHTML = '<p class="stamp">這張圖的語法有誤，改顯示原始內容。輸入 /flow 可以重畫。</p><pre class="raw"></pre>'
      card.querySelector('.raw').textContent = code.split('\\nclassDef')[0]
      console.error(err)
    })
</script>
</body></html>
`
}
