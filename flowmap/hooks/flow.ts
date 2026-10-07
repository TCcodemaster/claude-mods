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
  '第一行：以「摘要：」開頭，用一句完整的繁體中文句子說明重點，不超過 40 個字。',
  '接著是一個 ```mermaid 程式碼區塊。',
  '目的是讓人不讀原文也能看懂完整流程：主軸要有，關鍵的條件、分支、例外處理和產出也要畫出來。只省略純粹的措辭與重複說明。',
  '先依內容挑圖的種類：',
  '- 有先後步驟或判斷分支：flowchart TD。',
  '- 分類、比較、選項整理：flowchart TD 的樹狀圖，根節點在上，每層最多 5 個分支，最多三層。',
  '- 多個方案比較：樹狀圖，每個方案一個節點，標籤寫最關鍵的取捨，不要把每個優缺點拆成節點；原文有建議就加一個結論節點。',
  '- 除錯或追查報告：最多 8 個節點，畫「症狀、原因、修法、結果」這條主線；追查過程合併成一個節點，修法有幾項就分幾支。',
  '- 分階段的計畫或有編號的項目清單（沒有月份或日期）：樹狀圖，根節點是計畫名稱，第二層是各階段，第三層是每個階段底下的項目。原文列了幾項就畫幾項，不受每層分支數限制，不要只畫階段。',
  '- 只有 3 到 6 個並列步驟、沒有分支，而且每步底下沒有子項目：flowchart LR 橫向。',
  '- 多個角色或系統之間來回呼叫：sequenceDiagram。',
  '- 狀態之間的轉換：stateDiagram-v2。',
  '- 依月份、日期排列的時程：timeline，優先於樹狀圖。',
  '- 兩個維度的比較或優先順序：quadrantChart。',
  '- 資料表與關聯：erDiagram，每張表只列主鍵、外鍵和最多 2 個關鍵欄位。',
  '- 不要使用 mindmap。',
  '共同規則：文字用繁體中文短句，每個標籤不超過 16 個字；指令、檔名、API 名稱保留原文；元素數量跟著原文走：原文只有三步就畫三步，一般圖不超過 16 個元素，分階段計畫或編號清單最多 30 個；不要寫 style、classDef 或註解。',
  'flowchart 額外規則：',
  '- 節點代號用 A、B、C 這類英文字母，標籤一律加雙引號，例如 A["讀取設定"]。',
  '- 只有原文明確寫出兩種以上結果時才畫判斷。判斷用菱形 {"…?"}，每個判斷都要畫出所有分支（至少兩條），每條分支都加標籤，例如 C -->|是| D、C -->|否| E。',
  '- 箭頭只代表「接下來會發生」。並列的類別或管道從同一個上層節點各自分出去，不要用箭頭串成先後。',
  '- 期限、條件、審查範圍這類說明，寫進同一個節點的標籤裡，不要拆成下一個節點。',
  '- 只畫原文有寫的內容。原文沒寫的判斷、迴圈、等待或重試都不要自己加，也不要把一步拆成好幾個節點。',
  '- 原文有失敗、重試、回退或例外路徑時要畫出來，不要只畫順利的那條路。',
  '- 節點數超過上限時，才合併次要細節；編號清單的項目不要合併，改成只留項目名稱。',
  '- 每個節點第一次出現時加上類別：:::start 起點、:::step 一般步驟、:::decide 判斷、:::done 結果、:::warn 風險或注意事項。',
  '各種圖的語法範本（照抄結構，不要自創語法）：',
  'sequenceDiagram 範本：\nsequenceDiagram\n  participant A as 使用者\n  participant B as 伺服器\n  A->>B: 送出請求\n  B-->>A: 回傳結果',
  'stateDiagram-v2 範本：\nstateDiagram-v2\n  [*] --> 待處理\n  待處理 --> 處理中: 開始\n  處理中 --> [*]',
  'timeline 範本：\ntimeline\n  title 標題\n  第一階段 : 事件一 : 事件二\n  第二階段 : 事件三',
  'quadrantChart 範本（座標一定要用中括號，數值介於 0 到 1）：\nquadrantChart\n  title 標題\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n  quadrant-1 優先做\n  quadrant-2 值得投資\n  quadrant-3 暫緩\n  quadrant-4 快速見效\n  方案甲: [0.3, 0.6]',
  'erDiagram 範本：\nerDiagram\n  USER ||--o{ ORDER : places\n  USER {\n    int id\n  }',
].join('\n')

// 檢查流程圖常見的錯誤，回傳問題清單；空陣列代表沒有問題。
export const MAX_NODES = 32
export function checkFlow(parsed: Parsed): string[] {
  if (parsed.diagram !== 'flowchart') return []
  const problems: string[] = []
  if (parsed.nodes.length > MAX_NODES) {
    problems.push(`節點有 ${parsed.nodes.length} 個，超過 ${MAX_NODES} 個，請合併或省略細節。`)
  }
  for (const node of parsed.nodes) {
    const outs = parsed.edges.filter(edge => edge.from === node.id)
    const touched = outs.length > 0 || parsed.edges.some(edge => edge.to === node.id)
    if (node.kind === 'decide' && outs.length < 2) {
      problems.push(`判斷「${node.label}」只有 ${outs.length} 條分支，每個判斷都要畫出所有分支。`)
    }
    if (node.kind === 'decide' && outs.some(edge => edge.label === '')) {
      problems.push(`判斷「${node.label}」有分支沒有標籤。`)
    }
    if (!touched && parsed.nodes.length > 1) {
      problems.push(`節點「${node.label}」沒有任何連線。`)
    }
  }
  return problems
}

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
  // 但主線很長時改橫向會拉得太寬，所以只在層數不多時才改。
  const fanOut = Math.max(0, ...nodes.map(node => edges.filter(edge => edge.from === node.id).length))
  const asked = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)/.exec(mermaid)?.[1] ?? 'TD'
  const direction = fanOut > 3 && depthOf(nodes, edges) <= 4 ? 'LR' : asked
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

// 從沒有入邊的節點往下走，算出最長路徑有幾層；遇到迴圈不重複走。
export function depthOf(nodes: FlowNode[], edges: FlowEdge[]): number {
  const level = new Map<string, number>()
  let frontier = nodes.filter(node => !edges.some(edge => edge.to === node.id)).map(node => node.id)
  if (frontier.length === 0) frontier = nodes.slice(0, 1).map(node => node.id)
  for (let depth = 1; frontier.length > 0; depth += 1) {
    for (const id of frontier) level.set(id, depth)
    frontier = [...new Set(edges.filter(edge => frontier.includes(edge.from) && !level.has(edge.to)).map(edge => edge.to))]
  }
  return Math.max(0, ...level.values())
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

// 本機版 cmux 回「OK surface=surface:7 ...」，遠端版回 JSON（surface_id 或 surface_ref）。
export function parseSurface(stdout: string): string | null {
  try {
    const data = JSON.parse(stdout) as { surface_id?: unknown; surface_ref?: unknown }
    const id = data.surface_id ?? data.surface_ref
    if (typeof id === 'string' && id !== '') return id
  } catch {
    // 不是 JSON，改用文字格式解析。
  }
  return /surface=(\S+)/.exec(stdout)?.[1] ?? null
}

// 從 `cmux --json list-panels` 找這個工作區裡已經開著的圖解分頁：優先選分頁列上正在顯示的，否則選最後開的。
export function findPane(stdout: string): string | null {
  try {
    const data = JSON.parse(stdout) as { surfaces?: { type?: string; title?: string; ref?: string; selected_in_pane?: boolean }[] }
    const panes = (data.surfaces ?? []).filter(s => s.type === 'browser' && s.title === '圖解' && typeof s.ref === 'string')
    return (panes.find(s => s.selected_in_pane) ?? panes.at(-1))?.ref ?? null
  } catch {
    return null
  }
}

// 給 mermaid-cli 渲染成圖片的原始碼：摘要當標題，流程圖補上淺色配色。
export function mermaidForImage(summary: string, mermaid: string, diagram: string): string {
  const title = summary.replace(/^摘要[:：]\s*/, '').replace(/"/g, "'")
  const init = {
    theme: 'base',
    themeVariables: {
      fontFamily: 'PingFang TC, sans-serif',
      fontSize: '18px',
      lineColor: '#9aa1ab',
      edgeLabelBackground: '#ffffff',
    },
  }
  const defs = diagram === 'flowchart'
    ? [
        'classDef start fill:#e3efff,stroke:#2f6fde,stroke-width:2px,color:#1f2328',
        'classDef step fill:#f3f4f6,stroke:#8b95a5,stroke-width:2px,color:#1f2328',
        'classDef decide fill:#fff4d6,stroke:#d99a00,stroke-width:2px,color:#1f2328',
        'classDef done fill:#e3f7ea,stroke:#1f9d55,stroke-width:2px,color:#1f2328',
        'classDef warn fill:#ffe7e5,stroke:#d63b2f,stroke-width:2px,color:#1f2328',
      ]
    : []
  return [
    ...(title === '' ? [] : ['---', `title: "${title}"`, '---']),
    `%%{init: ${JSON.stringify(init)}}%%`,
    mermaid,
    ...defs.map(line => `  ${line}`),
  ].join('\n')
}

// 遠端版 cmux（SSH 工作區）單次請求超過約 16 KB 就回 server returned error response，
// data URL 與 browser.eval 的腳本都受限；這個值留了餘裕給 JSON 包裝。
export const CMUX_LIMIT = 12000

// 中文與空白用 percent 編碼會膨脹三倍，base64 只有 4/3，頁面能小很多。
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${toBase64(html)}`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 給 cmux 瀏覽器窗格的頁面；配色依系統深淺色切換。
// 換圖函式的參數：JSON 字串化，並把 < 換掉，避免提早結束 <script>。
export function renderArgs(summary: string, mermaid: string, stamp: string): string {
  return [summary.replace(/^摘要[:：]\s*/, ''), mermaid, stamp]
    .map(value => JSON.stringify(value).replace(/</g, '\\u003c'))
    .join(', ')
}

// 把 base64 內容交給頁面裡的函式，拆成幾段依序用 browser.eval 執行：
// 塞得進單次上限就直接呼叫；塞不進就先累積在頁面裡，最後一段才呼叫。累積段只回短字串，不把整個緩衝傳回來。
export function chunkScripts(payload: string, call: (arg: string) => string, limit = CMUX_LIMIT): string[] {
  if (payload.length <= limit) return [call(`"${payload}"`)]
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += limit) chunks.push(payload.slice(i, i + limit))
  return [
    ...chunks.map((chunk, i) => `(window.flowmapBuf = ${i === 0 ? '' : 'window.flowmapBuf + '}"${chunk}", 'flowmap-buf')`),
    call('window.flowmapBuf'),
  ]
}

// 在已經開著的圖解頁面上換圖；最後一段回 ok 代表頁面認得換圖函式。
export function renderScripts(summary: string, mermaid: string, stamp: string, limit = CMUX_LIMIT): string[] {
  const payload = toBase64(JSON.stringify([summary.replace(/^摘要[:：]\s*/, ''), mermaid, stamp]))
  return chunkScripts(payload, arg => `window.flowmapRenderB64 ? (window.flowmapRenderB64(${arg}), 'flowmap-ok') : 'flowmap-missing'`, limit)
}

// 完整頁面塞不進 data URL 時先開這個啟動頁，再把整頁分段送進去，用 document.write 換成真正的頁面。
export const BOOT_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>圖解</title></head><body><script>
window.flowmapBoot = b64 => {
  const html = new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)))
  document.open(); document.write(html); document.close()
  return 'flowmap-ok'
}
</script></body></html>`
export const BOOT_READY = 'typeof window.flowmapBoot'

export function bootScripts(html: string, limit = CMUX_LIMIT): string[] {
  return chunkScripts(toBase64(html), arg => `window.flowmapBoot ? window.flowmapBoot(${arg}) : 'flowmap-missing'`, limit)
}

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
  .stamp { color: var(--muted); font-size: 13px; margin: 0 0 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; overflow: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; color: var(--muted); font-size: 14px; }
  .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 3px;
    margin-right: 6px; vertical-align: -1px; background: var(--c); }
  pre.mermaid { margin: 0; text-align: center; }
  pre.mermaid svg { max-width: none !important; height: auto; }
  .zoom { margin-left: auto; display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .zoom .gap { width: 10px; }
  .zoom button:disabled { opacity: 0.35; cursor: default; }
  .zoom button { font: inherit; width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--card); color: var(--fg); cursor: pointer; }
  pre.raw { margin: 0; white-space: pre-wrap; font: 13px/1.6 ui-monospace, Menlo, monospace; }
  .zoom .wide { width: auto; padding: 0 8px; }
  .zoom select { font: inherit; height: 26px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--card); color: var(--fg); padding: 0 6px; }
  .editor { margin-top: 12px; }
  .editor[hidden] { display: none; }
  .editor textarea { width: 100%; box-sizing: border-box; min-height: 180px; resize: vertical; padding: 10px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg);
    font: 13px/1.6 ui-monospace, Menlo, monospace; }
  .editor .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; color: var(--muted); font-size: 13px; }
  .editor .row button { font: inherit; height: 26px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--card); color: var(--fg); cursor: pointer; }
  .note { color: var(--muted); font-size: 13px; margin: 8px 0 0; min-height: 1.2em; }
</style></head>
<body><main>
<p class="summary" id="summary"></p>
<p class="stamp"><span id="stamp"></span><span class="zoom"><button id="prev" title="上一張（←）">‹</button><span id="pos">1 / 1</span><button id="next" title="下一張（→）">›</button><span class="gap"></span><button id="zout" title="縮小">－</button><span id="zval">100%</span><button id="zin" title="放大">＋</button><span class="gap"></span><button class="wide" id="edit" title="編輯 Mermaid 語法">編輯</button><select id="export" title="匯出"><option value="">匯出</option><option value="svg">SVG 圖檔</option><option value="png">PNG 圖檔</option><option value="mmd">Mermaid 原始碼</option><option value="copy">複製原始碼</option></select></span></p>
<div class="card" id="card"></div>
<div class="legend" id="legend"></div>
<div class="editor" id="editor" hidden><textarea id="code" spellcheck="false"></textarea><div class="row"><button id="apply">套用</button><button id="revert">還原</button><span>⌘Enter 套用；套用後會存成新的一張，可用上一張回到原圖</span></div></div>
<p class="note" id="note"></p>
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
  const defs = Object.entries(palette).map(([k, [fill, stroke]]) =>
    'classDef ' + k + ' fill:' + fill + ',stroke:' + stroke + ',stroke-width:2px,color:' + (dark ? '#e6e6e6' : '#1f2328'))
  const config = { startOnLoad: false, theme: 'base', darkMode: dark, securityLevel: 'strict',
    flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 36, rankSpacing: 48, useMaxWidth: false },
    sequence: { useMaxWidth: false }, state: { useMaxWidth: false }, timeline: { useMaxWidth: false },
    er: { useMaxWidth: false }, quadrantChart: { useMaxWidth: false }, mindmap: { useMaxWidth: false },
    themeVariables: { fontFamily: '-apple-system, "PingFang TC", sans-serif', fontSize: '22px',
      lineColor: dark ? '#6b7280' : '#9aa1ab', edgeLabelBackground: dark ? '#1e2128' : '#ffffff',
      primaryColor: dark ? '#1d3a5c' : '#e3efff', primaryBorderColor: dark ? '#7cb7ff' : '#2f6fde',
      primaryTextColor: dark ? '#e6e6e6' : '#1f2328', secondaryColor: dark ? '#173d2a' : '#e3f7ea',
      tertiaryColor: dark ? '#4a3a12' : '#fff4d6', actorBkg: dark ? '#1d3a5c' : '#e3efff',
      actorBorder: dark ? '#7cb7ff' : '#2f6fde', noteBkgColor: dark ? '#4a3a12' : '#fff4d6' } }
  mermaid.initialize(config)
  // 縮放比例記在這個頁面的瀏覽器儲存裡，下一張圖沿用。
  let scale = 1
  try { scale = Number(localStorage.getItem('flowmap-zoom')) || 1 } catch (e) {}
  // 用 SVG 本身的寬度縮放；CSS zoom 在 WebKit 會切掉節點裡的文字。
  const applyZoom = () => {
    const svg = document.querySelector('#card svg')
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
  // 這個窗格看過的圖都記在 history，用上一張、下一張切換，最多保留 20 張。
  const history = []
  let index = -1
  let seq = 0
  const updateNav = () => {
    document.getElementById('pos').textContent = (index + 1) + ' / ' + history.length
    document.getElementById('prev').disabled = index <= 0
    document.getElementById('next').disabled = index >= history.length - 1
  }
  const show = i => {
    index = i
    updateNav()
    const { summary, code, stamp } = history[i]
    document.getElementById('summary').textContent = summary
    document.getElementById('stamp').textContent = stamp
    document.getElementById('code').value = code
    const isFlow = /^(flowchart|graph)\\s/.test(code.trim())
    document.getElementById('legend').innerHTML = isFlow
      ? Object.entries(palette).map(([k, [, stroke]]) => '<span style="--c:' + stroke + '">' + names[k] + '</span>').join('')
      : ''
    const full = isFlow ? code + '\\n' + defs.join('\\n') : code
    const card = document.getElementById('card')
    seq += 1
    const id = 'flowmap-' + seq
    return mermaid.parse(full)
      .then(() => mermaid.render(id, full))
      .then(({ svg }) => {
        // 快速切換時，晚畫完的舊圖不要蓋掉新圖。
        if (id !== 'flowmap-' + seq) return
        card.innerHTML = '<pre class="mermaid">' + svg + '</pre>'
        applyZoom()
      })
      .catch(err => {
        if (id !== 'flowmap-' + seq) return
        card.innerHTML = '<p class="stamp">這張圖的語法有誤，改顯示原始內容。輸入 /flow 可以重畫。</p><pre class="raw"></pre>'
        card.querySelector('.raw').textContent = code
        console.error(err)
      })
  }
  // 換圖：記進 history 並顯示最新一張；外掛用 eval 或 postMessage 呼叫，不必重新載入頁面。
  window.flowmapRender = (summary, code, stamp) => {
    history.push({ summary, code, stamp })
    if (history.length > 20) history.shift()
    return show(history.length - 1)
  }
  // cmux 的 browser.eval 用這個入口：參數是 [摘要, 圖, 時間] 的 JSON 再 base64。
  window.flowmapRenderB64 = b64 => {
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
    const [summary, code, stamp] = JSON.parse(new TextDecoder().decode(bytes))
    return window.flowmapRender(summary, code, stamp)
  }
  document.getElementById('prev').onclick = () => index > 0 && show(index - 1)
  document.getElementById('next').onclick = () => index < history.length - 1 && show(index + 1)
  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'TEXTAREA') return
    if (e.key === 'ArrowLeft' && index > 0) show(index - 1)
    if (e.key === 'ArrowRight' && index < history.length - 1) show(index + 1)
  })
  // 編輯語法：套用後存成新的一張並重畫，原圖留在歷史裡。
  const editor = document.getElementById('editor')
  const codeBox = document.getElementById('code')
  const note = msg => { document.getElementById('note').textContent = msg }
  document.getElementById('edit').onclick = () => {
    editor.hidden = !editor.hidden
    if (!editor.hidden) codeBox.focus()
  }
  const apply = () => {
    if (index < 0) return
    const { summary, stamp } = history[index]
    const base = stamp.replace(/（已編輯）$/, '')
    window.flowmapRender(summary, codeBox.value, base + '（已編輯）')
  }
  document.getElementById('apply').onclick = apply
  document.getElementById('revert').onclick = () => { if (index >= 0) codeBox.value = history[index].code }
  codeBox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply() }
  })
  // 匯出：SVG 與原始碼直接下載；PNG 先改用純 SVG 文字重畫（HTML 標籤畫進 canvas 會失敗），再轉成圖片。
  // 在 VS Code 的 webview 裡下載連結不會動作，改用 postMessage 請擴充套件開存檔對話框。
  const vscodeApi = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null
  const pad = n => String(n).padStart(2, '0')
  const fileStem = () => {
    const d = new Date()
    return 'flowmap-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  }
  const saveHref = (name, href) => {
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  const download = (name, mime, text) => {
    if (vscodeApi) { vscodeApi.postMessage({ type: 'flowmap-save', name, text }); return }
    saveHref(name, 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text))
  }
  const currentSvg = () => {
    const svg = document.querySelector('#card svg')
    if (!svg) return null
    const copy = svg.cloneNode(true)
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.removeAttribute('style')
    return copy.outerHTML
  }
  const renderPlain = code => {
    const isFlow = /^(flowchart|graph)\\s/.test(code.trim())
    const full = isFlow ? code + '\\n' + defs.join('\\n') : code
    mermaid.initialize({ ...config, flowchart: { ...config.flowchart, htmlLabels: false } })
    return mermaid.render('flowmap-export', full).finally(() => mermaid.initialize(config))
  }
  const toPng = svgText => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ratio = 2
      canvas.width = Math.ceil(img.width * ratio)
      canvas.height = Math.ceil(img.height * ratio)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = dark ? '#16181d' : '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(ratio, ratio)
      ctx.drawImage(img, 0, 0)
      try { resolve(canvas.toDataURL('image/png')) } catch (err) { reject(err) }
    }
    img.onerror = () => reject(new Error('svg load failed'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText)
  })
  const copyText = text => {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(() => {}); return true }
    const box = document.createElement('textarea')
    box.value = text
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  }
  document.getElementById('export').onchange = e => {
    const kind = e.target.value
    e.target.value = ''
    if (index < 0) return
    const code = history[index].code
    note('')
    if (kind === 'mmd') download(fileStem() + '.mmd', 'text/plain', code)
    if (kind === 'copy') note(copyText(code) ? '已複製 Mermaid 原始碼。' : '複製失敗，請改用匯出原始碼。')
    if (kind === 'svg') {
      const svg = currentSvg()
      if (svg) download(fileStem() + '.svg', 'image/svg+xml', svg)
      else note('目前沒有畫出的圖可以匯出。')
    }
    if (kind === 'png') {
      note('正在產生 PNG…')
      renderPlain(code)
        .then(({ svg }) => {
          const box = document.createElement('div')
          box.innerHTML = svg
          const el = box.querySelector('svg')
          el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
          const vb = el.viewBox && el.viewBox.baseVal
          if (vb && vb.width) { el.setAttribute('width', Math.ceil(vb.width)); el.setAttribute('height', Math.ceil(vb.height)) }
          return toPng(el.outerHTML)
        })
        .then(url => {
          const name = fileStem() + '.png'
          if (vscodeApi) { vscodeApi.postMessage({ type: 'flowmap-save', name, base64: url.split(',')[1] }); note(''); return }
          saveHref(name, url)
          note('PNG 已下載到「下載項目」。')
        })
        .catch(err => { console.error(err); note('PNG 產生失敗，請改匯出 SVG。') })
    }
  }
  // VS Code 檢視器用 postMessage 送新圖。
  window.addEventListener('message', e => {
    const d = e.data
    if (d && d.type === 'flowmap') window.flowmapRender(d.summary, d.mermaid, d.stamp)
  })
  applyZoom()
  window.flowmapRender(${renderArgs(summary, mermaid, stamp)})
</script>
</body></html>
`
}
