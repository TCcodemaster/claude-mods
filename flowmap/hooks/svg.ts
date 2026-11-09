import type { FlowEdge, FlowNode } from '../types'

// 桌面版、VS Code 與手機的圖解面板能畫 SVG，但 mod 裡沒有 DOM 也沒有 Mermaid，
// 所以在這裡自己排版：分層、排序、定座標，再輸出節點與箭頭。終端機不能畫 SVG，仍用縮排大綱。

const FONT = 15
const LINE = 20
const PAD_X = 14
const PAD_Y = 10
const WRAP = 130
const MIN_W = 96
const GAP_X = 24
const GAP_Y = 48
const MARGIN = 16
const DUMMY_W = 10

// 淺色寫在屬性上；深色用樣式覆蓋，樣式被濾掉時仍是可讀的淺色圖。
export const LIGHT: Record<string, [string, string]> = {
  start: ['#e3efff', '#2f6fde'],
  step: ['#f3f4f6', '#8b95a5'],
  decide: ['#fff4d6', '#d99a00'],
  done: ['#e3f7ea', '#1f9d55'],
  warn: ['#ffe7e5', '#d63b2f'],
}
export const DARK: Record<string, [string, string]> = {
  start: ['#1d3a5c', '#7cb7ff'],
  step: ['#2a2f3a', '#aab4c3'],
  decide: ['#4a3a12', '#f2c14e'],
  done: ['#173d2a', '#5fd38d'],
  warn: ['#4a1f22', '#ff7b72'],
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const charWidth = (ch: string) => (WIDE.test(ch) ? FONT : FONT * 0.58)
export const textWidth = (text: string) => [...text].reduce((sum, ch) => sum + charWidth(ch), 0)

// 依寬度折行；英文、路徑與指令盡量整段不拆。
export function wrapLabel(text: string, max = WRAP): string[] {
  const greedy = (limit: number) => {
    const lines: string[] = []
    let line = ''
    let width = 0
    const flush = () => {
      if (line.trim() !== '') lines.push(line.trim())
      line = ''
      width = 0
    }
    for (const token of text.match(/[\w.\-~/@:+=]+|\s+|[^\w\s]/gu) ?? []) {
      const w = textWidth(token)
      if (w > limit) {
        for (const ch of token) {
          if (width + charWidth(ch) > limit) flush()
          line += ch
          width += charWidth(ch)
        }
        continue
      }
      if (width + w > limit) {
        flush()
        if (token.trim() === '') continue
      }
      line += token
      width += w
    }
    flush()
    return lines.length > 0 ? lines : ['']
  }
  const first = greedy(max)
  // 有全形冒號、逗號這類標點時，行數不增加就在標點後面換行，不把一個詞切成兩半。
  const pieces = text.replace(/([：，；、])/g, '$1\n').split('\n').map(piece => piece.trim()).filter(Boolean)
  if (first.length > 1 && pieces.length > 1 && pieces.every(piece => textWidth(piece) <= max)) {
    const lines: string[] = []
    for (const piece of pieces) {
      const last = lines.at(-1)
      if (last !== undefined && textWidth(last + piece) <= max) lines[lines.length - 1] = last + piece
      else lines.push(piece)
    }
    if (lines.length <= first.length) return lines
  }
  // 行數不變的前提下把每行寬度拉平，避免最後一行只剩一兩個字；但不窄到把英文單字或路徑切開。
  const longest = Math.max(0, ...(text.match(/[\w.\-~/@:+=]+/gu) ?? []).map(textWidth).filter(w => w <= max))
  let best = first
  for (let limit = max - 4; first.length > 1 && limit >= Math.max(max / 2, longest); limit -= 4) {
    const tried = greedy(limit)
    if (tried.length > first.length) break
    best = tried
  }
  return best
}

type Item = { id: string; node: FlowNode | null; lines: string[]; w: number; h: number; rank: number; x: number; y: number }
type Chain = { edge: FlowEdge; ids: string[] }
export type FlowLayout = { width: number; height: number; items: Map<string, Item>; chains: Chain[]; rowTop: number[]; rowHeight: number[] }

export function layoutFlow(given: FlowNode[], edges: FlowEdge[]): FlowLayout {
  const byId = new Map(given.map(node => [node.id, node]))
  const valid = edges.filter(edge => byId.has(edge.from) && byId.has(edge.to))
  let nodes = given
  const outsOf = (id: string) => valid.filter(edge => edge.from === id)

  // 1. 深度優先走一遍，回頭的邊（迴圈）另外畫，不參與分層。
  const state = new Map<string, 'open' | 'done'>()
  const back = new Set<FlowEdge>()
  const found: string[] = []
  const visit = (id: string) => {
    state.set(id, 'open')
    found.push(id)
    for (const edge of outsOf(id)) {
      const s = state.get(edge.to)
      if (s === 'open') back.add(edge)
      else if (s === undefined) visit(edge.to)
    }
    state.set(id, 'done')
  }
  const hasIn = new Set(valid.map(edge => edge.to))
  for (const node of nodes) if (!hasIn.has(node.id) && !state.has(node.id)) visit(node.id)
  for (const node of nodes) if (!state.has(node.id)) visit(node.id)
  // 回頭的邊改接到一個「回到某步驟」的小標籤，跟著其他節點一起排版，線就不會橫越別的節點。
  const refs: FlowNode[] = [...back].map((edge, i) => ({
    id: `^${i}`,
    label: `回到「${byId.get(edge.to)?.label ?? edge.to}」`,
    kind: 'ref',
  }))
  nodes = [...nodes, ...refs]
  const forward = [
    ...valid.filter(edge => !back.has(edge)),
    ...[...back].map((edge, i) => ({ from: edge.from, to: `^${i}`, label: edge.label })),
  ]
  // 小標籤排在來源節點旁邊。
  ;[...back].forEach((edge, i) => found.splice(found.indexOf(edge.from) + 1, 0, `^${i}`))

  // 2. 分層：每個節點放在所有前一步的下一層。
  const rank = new Map(nodes.map(node => [node.id, 0]))
  const pending = new Map(nodes.map(node => [node.id, forward.filter(edge => edge.to === node.id).length]))
  const queue = nodes.filter(node => pending.get(node.id) === 0).map(node => node.id)
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const edge of forward.filter(e => e.from === id)) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, (rank.get(id) ?? 0) + 1))
      const left = (pending.get(edge.to) ?? 1) - 1
      pending.set(edge.to, left)
      if (left === 0) queue.push(edge.to)
    }
  }

  // 3. 跨好幾層的邊插入看不見的轉折點，讓線從節點之間穿過。
  const items = new Map<string, Item>()
  for (const node of nodes) {
    const lines = wrapLabel(node.label)
    const extra = node.kind === 'decide' ? 28 : 0
    const minW = node.kind === 'ref' ? 0 : MIN_W
    const pad = node.kind === 'ref' ? 6 : PAD_Y
    const w = Math.max(minW, Math.max(...lines.map(textWidth)) + PAD_X * 2 + extra)
    items.set(node.id, { id: node.id, node, lines, w, h: lines.length * LINE + pad * 2, rank: rank.get(node.id) ?? 0, x: 0, y: 0 })
  }
  const discovered = new Map(found.map((id, i) => [id, i]))
  const chains: Chain[] = forward.map((edge, n) => {
    const from = rank.get(edge.from) ?? 0
    const to = rank.get(edge.to) ?? 0
    const ids = [edge.from]
    for (let r = from + 1; r < to; r += 1) {
      const id = `~${n}-${r}`
      items.set(id, { id, node: null, lines: [], w: DUMMY_W, h: 0, rank: r, x: 0, y: 0 })
      discovered.set(id, (discovered.get(edge.from) ?? 0) + 0.5)
      ids.push(id)
    }
    ids.push(edge.to)
    return { edge, ids }
  })
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const { ids } of chains) {
    for (let i = 0; i + 1 < ids.length; i += 1) {
      const a = ids[i] ?? ''
      const b = ids[i + 1] ?? ''
      succs.set(a, [...(succs.get(a) ?? []), b])
      preds.set(b, [...(preds.get(b) ?? []), a])
    }
  }

  // 4. 同一層的左右順序：先照發現順序，再用上下層鄰居的平均位置來回調整，減少交叉。
  const depth = Math.max(0, ...[...items.values()].map(item => item.rank))
  const layers: string[][] = Array.from({ length: depth + 1 }, () => [])
  for (const item of [...items.values()].sort((a, b) => (discovered.get(a.id) ?? 0) - (discovered.get(b.id) ?? 0))) {
    layers[item.rank]?.push(item.id)
  }
  const position = new Map<string, number>()
  const index = () => layers.forEach(layer => layer.forEach((id, i) => position.set(id, i)))
  index()
  // 這個方向沒有鄰居的節點（例如「回到」標籤沒有下一步）留在原位，其餘依鄰居平均位置排進剩下的空位。
  const reorder = (layer: string[], near: Map<string, string[]>) => {
    const hasNear = (id: string) => (near.get(id) ?? []).length > 0
    const baryOf = (id: string) => {
      const around = near.get(id) ?? []
      return around.reduce((s, n) => s + (position.get(n) ?? 0), 0) / around.length
    }
    const sorted = layer.filter(hasNear).sort((a, b) => baryOf(a) - baryOf(b))
    let k = 0
    layer.forEach((id, i) => {
      if (hasNear(id)) layer[i] = sorted[k++] ?? id
    })
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let r = 1; r <= depth; r += 1) reorder(layers[r] ?? [], preds)
    index()
    for (let r = depth - 1; r >= 0; r -= 1) reorder(layers[r] ?? [], succs)
    index()
  }

  // 5. 橫向座標：最長的那條路當主軸排成一直線，其他節點盡量對齊上一層的來源，左右推開不重疊。
  const deepest = [...items.values()].filter(item => item.node).sort((a, b) => b.rank - a.rank)[0]
  const spine = new Set<string>()
  for (let id = deepest?.id; id !== undefined; ) {
    spine.add(id)
    const rankHere = items.get(id)?.rank ?? 0
    // 上一層若同時有真正的節點和長邊的轉折點，主軸走真正的節點。
    const above = (preds.get(id) ?? []).filter(p => (items.get(p)?.rank ?? 0) === rankHere - 1)
    id = above.find(p => items.get(p)?.node) ?? above[0]
  }
  const sep = (a: string, b: string) => ((items.get(a)?.w ?? 0) + (items.get(b)?.w ?? 0)) / 2 + GAP_X
  const centerOf = (ids: string[]) => ids.reduce((sum, id) => sum + (items.get(id)?.x ?? 0), 0) / ids.length
  const place = (layer: string[], desired: (id: string) => number) => {
    const anchor = Math.max(0, layer.findIndex(id => spine.has(id)))
    const xs = layer.map(desired)
    if (spine.has(layer[anchor] ?? '')) xs[anchor] = 0
    for (let i = anchor - 1; i >= 0; i -= 1) xs[i] = Math.min(xs[i] ?? 0, (xs[i + 1] ?? 0) - sep(layer[i] ?? '', layer[i + 1] ?? ''))
    for (let i = anchor + 1; i < layer.length; i += 1) xs[i] = Math.max(xs[i] ?? 0, (xs[i - 1] ?? 0) + sep(layer[i - 1] ?? '', layer[i] ?? ''))
    layer.forEach((id, i) => {
      const item = items.get(id)
      if (item) item.x = xs[i] ?? 0
    })
  }
  // 由上往下對齊來源；沒有來源的節點（第二個起點）再依它的下一步對齊一次。
  for (const layer of layers) {
    place(layer, id => {
      const around = preds.get(id) ?? []
      return around.length === 0 ? 0 : centerOf(around)
    })
  }
  for (const layer of [...layers].reverse()) {
    place(layer, id => {
      const above = preds.get(id) ?? []
      const below = succs.get(id) ?? []
      return above.length > 0 ? (items.get(id)?.x ?? 0) : below.length > 0 ? centerOf(below) : (items.get(id)?.x ?? 0)
    })
  }

  // 6. 縱向座標與整體大小。
  const rowHeight = layers.map(layer => Math.max(0, ...layer.map(id => items.get(id)?.h ?? 0)))
  const rowTop: number[] = []
  let top = MARGIN
  rowHeight.forEach((h, r) => {
    rowTop[r] = top
    top += h + GAP_Y
  })
  const left = Math.min(...[...items.values()].map(item => item.x - item.w / 2))
  for (const item of items.values()) {
    item.x += MARGIN - left
    item.y = (rowTop[item.rank] ?? 0) + ((rowHeight[item.rank] ?? 0) - item.h) / 2
  }
  const right = Math.max(...[...items.values()].map(item => item.x + item.w / 2))
  return {
    width: Math.ceil(right + MARGIN),
    height: Math.ceil(top - GAP_Y + MARGIN),
    items,
    chains,
    rowTop,
    rowHeight,
  }
}

export const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const n = (value: number) => Math.round(value * 10) / 10

// 分支標籤：字小一號，太長就折成兩行，放在箭頭進入目標之前。
const LABEL_FONT = 13
const LABEL_LINE = 16
type Tag = { x: number; y: number; w: number; h: number; lines: string[] }

function makeTag(x: number, bottom: number, text: string): Tag {
  const lines = wrapLabel(text, 140)
  const w = Math.max(...lines.map(textWidth)) * (LABEL_FONT / FONT) + 10
  const h = lines.length * LABEL_LINE + 4
  return { x, y: bottom - h, w, h, lines }
}

// 同一帶的標籤互相推開，直到不重疊；最多試幾輪，避免來回推不停。
function separate(tags: Tag[]): void {
  for (let round = 0; round < 12; round += 1) {
    let moved = false
    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const a = tags[i]
        const b = tags[j]
        if (!a || !b) continue
        const overlapX = (a.w + b.w) / 2 + 4 - Math.abs(a.x - b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        const [left, right] = a.x <= b.x ? [a, b] : [b, a]
        left.x -= overlapX / 2
        right.x += overlapX / 2
        moved = true
      }
    }
    if (!moved) return
  }
}

function drawTag(tag: Tag): string {
  const tspans = tag.lines.map((line, i) => `<tspan x="${n(tag.x)}" y="${n(tag.y + 2 + LABEL_FONT * 0.95 + i * LABEL_LINE)}">${escape(line)}</tspan>`).join('')
  return `<g class="lb"><rect x="${n(tag.x - tag.w / 2)}" y="${n(tag.y)}" width="${n(tag.w)}" height="${n(tag.h)}" rx="4" fill="#ffffff"/><text font-size="${LABEL_FONT}" text-anchor="middle" fill="#59636e">${tspans}</text></g>`
}

export function flowSvg(nodes: FlowNode[], edges: FlowEdge[]): string {
  return drawFlow(nodes, edges).source
}

// 節點：起點與結果用膠囊形，判斷用六角形，「回到」用虛線小標籤，其餘用圓角矩形。
function drawNode(item: Item): string[] {
  const node = item.node
  if (!node) return []
  const { x, y, w, h } = item
  if (node.kind === 'ref') {
    const tspans = item.lines.map((line, i) => `<tspan x="${n(x)}" y="${n(y + 6 + FONT * 0.95 + i * LINE)}">${escape(line)}</tspan>`).join('')
    return [
      `<rect class="rf" x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="none" stroke="#9aa1ab" stroke-width="1.4" stroke-dasharray="4 3"/>`,
      `<text class="m" text-anchor="middle" fill="#59636e">${tspans}</text>`,
    ]
  }
  const kind = LIGHT[node.kind] ? node.kind : 'step'
  const [fill, stroke] = LIGHT[kind] ?? ['#f3f4f6', '#8b95a5']
  const attrs = `class="s ${kind}" fill="${fill}" stroke="${stroke}" stroke-width="2"`
  const parts: string[] = []
  if (kind === 'decide') {
    const c = 14
    parts.push(`<polygon ${attrs} points="${[[x - w / 2, y + h / 2], [x - w / 2 + c, y], [x + w / 2 - c, y], [x + w / 2, y + h / 2], [x + w / 2 - c, y + h], [x - w / 2 + c, y + h]].map(([a, b]) => `${n(a ?? 0)},${n(b ?? 0)}`).join(' ')}"/>`)
  } else {
    const r = kind === 'start' || kind === 'done' ? h / 2 : 8
    parts.push(`<rect ${attrs} x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(r, 22))}"/>`)
  }
  const weight = kind === 'step' ? '400' : '600'
  const tspans = item.lines.map((line, i) => `<tspan x="${n(x)}" y="${n(y + PAD_Y + FONT * 0.95 + i * LINE)}">${escape(line)}</tspan>`).join('')
  parts.push(`<text class="t" text-anchor="middle" font-weight="${weight}" fill="#1f2328">${tspans}</text>`)
  return parts
}

// 圖例：只列圖裡用到的顏色，少於兩種就不畫；放不下一行就換行。
const KIND_NAMES: Record<string, string> = { start: '起點', step: '步驟', decide: '判斷', done: '結果', warn: '注意' }
function drawLegend(nodes: FlowNode[], left: number, top: number, width: number): { parts: string[]; height: number } {
  const used = new Set(nodes.map(node => (LIGHT[node.kind] ? node.kind : node.kind === 'ref' ? '' : 'step')))
  const kinds = Object.keys(KIND_NAMES).filter(kind => used.has(kind))
  if (kinds.length < 2) return { parts: [], height: 0 }
  const parts: string[] = []
  let x = left
  let y = top
  for (const kind of kinds) {
    const name = KIND_NAMES[kind] ?? kind
    const w = 18 + textWidth(name) * (LABEL_FONT / FONT)
    if (x > left && x + w > left + width) {
      x = left
      y += 22
    }
    const [fill, stroke] = LIGHT[kind] ?? ['#f3f4f6', '#8b95a5']
    parts.push(`<rect class="s ${kind}" x="${n(x)}" y="${n(y + 3)}" width="12" height="12" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`)
    parts.push(`<text class="m" font-size="${LABEL_FONT}" fill="#59636e" x="${n(x + 18)}" y="${n(y + 14)}">${escape(name)}</text>`)
    x += w + 16
  }
  return { parts, height: y - top + 22 }
}

function wrapFlow(minX: number, width: number, height: number, body: string[]): string {
  const dark = Object.entries(DARK).map(([kind, [fill, stroke]]) => `.s.${kind}{fill:${fill};stroke:${stroke}}`).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif" font-size="${FONT}">`,
    `<style>@media (prefers-color-scheme: dark){${dark}.t{fill:#e6e6e6}.e{stroke:#6b7280}.ah{fill:#6b7280}.lb rect{fill:#1e2128}.lb text{fill:#9aa4b2}.m{fill:#9aa4b2}.rf{stroke:#6b7280}}</style>`,
    '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z" fill="#9aa1ab"/></marker></defs>',
    ...body,
    '</svg>',
  ].join('')
}

// ── 樹狀圖 ──────────────────────────────────────────────
// 每個節點最多一個上層、沒有迴圈，就是樹：分類、清單、分階段計畫、方案比較。
// 末端比層數多時，由上往下排會把末端擠成一長列，上層也不在自己的子項正上方，線斜拉好幾百像素疊在一起。
// 這種圖改成由左往右：每層一欄，子項疊在上層右邊，上層對齊子項的中間；同組子項靠近，不同組之間留較大的空隙。

const TREE_WRAP = 180
const TREE_STUB = 14
const TREE_GAP = 40

// 回傳每個節點的子項；不是樹就回傳 null。
export function treeOf(nodes: FlowNode[], edges: FlowEdge[]): Map<string, string[]> | null {
  const ids = new Set(nodes.map(node => node.id))
  const parent = new Map<string, string>()
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue
    if (parent.has(edge.to) || edge.from === edge.to) return null
    parent.set(edge.to, edge.from)
  }
  for (const node of nodes) {
    const passed = new Set<string>()
    for (let id: string | undefined = node.id; id !== undefined; id = parent.get(id)) {
      if (passed.has(id)) return null
      passed.add(id)
    }
  }
  const kids = new Map(nodes.map(node => [node.id, [] as string[]]))
  for (const edge of edges) if (parent.get(edge.to) === edge.from) kids.get(edge.from)?.push(edge.to)
  return kids
}

export type TreeLayout = { width: number; height: number; items: Map<string, Item>; kids: Map<string, string[]> }

// 不是樹，或末端不比層數多（主線長、分支少的流程）時回傳 null，沿用由上往下的流程圖排版。
export function layoutTree(nodes: FlowNode[], edges: FlowEdge[]): TreeLayout | null {
  const kids = treeOf(nodes, edges)
  if (!kids) return null
  const childIds = new Set([...kids.values()].flat())
  const roots = nodes.filter(node => !childIds.has(node.id)).map(node => node.id)
  const depth = new Map<string, number>()
  const height = new Map<string, number>()
  const measure = (id: string, d: number): number => {
    depth.set(id, d)
    const h = Math.max(-1, ...(kids.get(id) ?? []).map(kid => measure(kid, d + 1))) + 1
    height.set(id, h)
    return h
  }
  roots.forEach(id => measure(id, 0))
  const leaves = nodes.filter(node => (kids.get(node.id) ?? []).length === 0).length
  const levels = Math.max(0, ...depth.values()) + 1
  if (leaves < 3 || leaves < levels) return null

  // 欄寬取這一欄最寬的節點，同欄節點等寬；欄距要放得下進入這一欄的分支標籤。
  const items = new Map<string, Item>()
  const colW: number[] = []
  for (const node of nodes) {
    const d = depth.get(node.id) ?? 0
    const lines = wrapLabel(node.label, TREE_WRAP)
    const w = Math.max(MIN_W, Math.max(...lines.map(textWidth)) + PAD_X * 2 + (node.kind === 'decide' ? 28 : 0))
    colW[d] = Math.max(colW[d] ?? 0, w)
    items.set(node.id, { id: node.id, node, lines, w, h: lines.length * LINE + PAD_Y * 2, rank: d, x: 0, y: 0 })
  }
  const labelW: number[] = []
  for (const edge of edges) {
    if (edge.label === '' || !items.has(edge.to)) continue
    const d = depth.get(edge.to) ?? 0
    labelW[d] = Math.max(labelW[d] ?? 0, makeTag(0, 0, edge.label).w)
  }
  const colLeft: number[] = [MARGIN]
  for (let d = 1; d < levels; d += 1) {
    const gap = labelW[d] ? TREE_STUB + 12 + (labelW[d] ?? 0) + 12 : TREE_GAP
    colLeft[d] = (colLeft[d - 1] ?? 0) + (colW[d - 1] ?? 0) + gap
  }
  for (const item of items.values()) {
    item.w = colW[item.rank] ?? item.w
    item.x = (colLeft[item.rank] ?? 0) + item.w / 2
  }

  // 由上往下疊：末端依序排，上層對齊第一個與最後一個子項的中間；上層比子項高時把子項整組往下移。
  // 兄弟之間的空隙依子樹深度加大，不同組一眼就分得開。
  const gapOf = (a: string, b: string) => 8 + 10 * Math.min(2, Math.max(height.get(a) ?? 0, height.get(b) ?? 0))
  const shift = (id: string, dy: number) => {
    const item = items.get(id)
    if (item) item.y += dy
    for (const kid of kids.get(id) ?? []) shift(kid, dy)
  }
  const place = (id: string, top: number): number => {
    const item = items.get(id)
    if (!item) return top
    const list = kids.get(id) ?? []
    if (list.length === 0) {
      item.y = top
      return top + item.h
    }
    let bottom = top
    list.forEach((kid, i) => {
      bottom = place(kid, i === 0 ? top : bottom + gapOf(list[i - 1] ?? '', kid))
    })
    const first = items.get(list[0] ?? '')
    const last = items.get(list.at(-1) ?? '')
    const mid = ((first?.y ?? 0) + (first?.h ?? 0) / 2 + (last?.y ?? 0) + (last?.h ?? 0) / 2) / 2
    item.y = mid - item.h / 2
    if (item.y < top) {
      const dy = top - item.y
      list.forEach(kid => shift(kid, dy))
      item.y = top
      bottom += dy
    }
    return Math.max(bottom, item.y + item.h)
  }
  let bottom = MARGIN
  roots.forEach((id, i) => {
    bottom = place(id, i === 0 ? MARGIN : bottom + gapOf(roots[i - 1] ?? '', id))
  })
  const right = Math.max(...[...items.values()].map(item => item.x + item.w / 2))
  return { width: Math.ceil(right + MARGIN), height: Math.ceil(bottom + MARGIN), items, kids }
}

// 上層右緣拉一小段到分岔直線，再轉直角進入各子項左緣，轉角畫成圓弧；分支標籤壓在進入子項前的那段線上。
function drawTree(nodes: FlowNode[], edges: FlowEdge[], layout: TreeLayout): { source: string; width: number; height: number } {
  const { items, kids } = layout
  const lines: string[] = []
  const tags: Tag[] = []
  for (const [id, list] of kids) {
    const from = items.get(id)
    if (!from) continue
    const x0 = from.x + from.w / 2
    const y0 = from.y + from.h / 2
    const tx = x0 + TREE_STUB
    for (const kid of list) {
      const to = items.get(kid)
      if (!to) continue
      const x1 = to.x - to.w / 2
      const y1 = to.y + to.h / 2
      const dy = y1 - y0
      const r = Math.min(8, Math.abs(dy) / 2)
      const s = Math.sign(dy)
      const d = Math.abs(dy) < 1
        ? `M${n(x0)},${n(y0)} H${n(x1)}`
        : `M${n(x0)},${n(y0)} H${n(tx - r)} Q${n(tx)},${n(y0)} ${n(tx)},${n(y0 + s * r)} V${n(y1 - s * r)} Q${n(tx)},${n(y1)} ${n(tx + r)},${n(y1)} H${n(x1)}`
      lines.push(`<path class="e" d="${d}" fill="none" stroke="#9aa1ab" stroke-width="1.6"/>`)
      const label = edges.find(edge => edge.from === id && edge.to === kid)?.label ?? ''
      if (label !== '') {
        const tag = makeTag((tx + x1) / 2, 0, label)
        tag.y = y1 - tag.h / 2
        tags.push(tag)
      }
    }
  }
  const legend = drawLegend(nodes, MARGIN, layout.height - MARGIN + 12, layout.width - MARGIN * 2)
  const height = layout.height + (legend.height > 0 ? legend.height + 12 : 0)
  const body = [...lines, ...[...items.values()].flatMap(drawNode), ...tags.map(drawTag), ...legend.parts]
  return { source: wrapFlow(0, layout.width, height, body), width: layout.width, height }
}

// 回傳 SVG 原始碼與原始寬高，面板依寬度縮放。
export function drawFlow(nodes: FlowNode[], edges: FlowEdge[]): { source: string; width: number; height: number } {
  const tree = layoutTree(nodes, edges)
  if (tree) return drawTree(nodes, edges, tree)
  const layout = layoutFlow(nodes, edges)
  const { items } = layout
  const parts: string[] = []
  const tags: Tag[] = []

  // 往下的邊：從節點底部出發，經過轉折點，進入目標頂部；標籤放在第一段的中點。
  for (const { edge, ids } of layout.chains) {
    const points: [number, number][] = []
    ids.forEach((id, i) => {
      const item = items.get(id)
      if (!item) return
      if (i === 0) points.push([item.x, item.y + item.h])
      else if (i === ids.length - 1) points.push([item.x, item.y])
      else points.push([item.x, layout.rowTop[item.rank] ?? 0], [item.x, (layout.rowTop[item.rank] ?? 0) + (layout.rowHeight[item.rank] ?? 0)])
    })
    let d = `M${n(points[0]?.[0] ?? 0)},${n(points[0]?.[1] ?? 0)}`
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1] ?? [0, 0]
      const [x1, y1] = points[i] ?? [0, 0]
      if (x0 === x1) d += ` L${n(x1)},${n(y1)}`
      else d += ` C${n(x0)},${n((y0 + y1) / 2)} ${n(x1)},${n((y0 + y1) / 2)} ${n(x1)},${n(y1)}`
    }
    parts.push(`<path class="e" d="${d}" fill="none" stroke="#9aa1ab" stroke-width="1.6" marker-end="url(#a)"/>`)
    // 標籤放在第一段的終點正上方：分支多時各自對齊自己的目標，不會擠在判斷底下。
    const [x1, y1] = points[1] ?? [0, 0]
    if (edge.label !== '') tags.push(makeTag(x1, y1 - 8, edge.label))
  }
  separate(tags)
  for (const item of items.values()) parts.push(...drawNode(item))

  // 推開後的標籤可能超出原本的畫布，左右各補一點空間。
  const minX = Math.min(0, ...tags.map(tag => tag.x - tag.w / 2 - 4))
  const maxX = Math.max(layout.width, ...tags.map(tag => tag.x + tag.w / 2 + 4))
  const width = Math.ceil(maxX - minX)
  const legend = drawLegend(nodes, minX + MARGIN, layout.height - MARGIN + 12, width - MARGIN * 2)
  const height = layout.height + (legend.height > 0 ? legend.height + 12 : 0)
  return { source: wrapFlow(minX, width, height, [...parts, ...tags.map(drawTag), ...legend.parts]), width, height }
}
