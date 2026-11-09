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
  // 行數不變的前提下把每行寬度拉平，避免最後一行只剩一兩個字；但不窄到把英文單字或路徑切開。
  const first = greedy(max)
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

// 回傳 SVG 原始碼與原始寬高，面板依寬度縮放。
export function drawFlow(nodes: FlowNode[], edges: FlowEdge[]): { source: string; width: number; height: number } {
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

  // 節點：起點與結果用膠囊形，判斷用六角形，「回到」用虛線小標籤，其餘用圓角矩形。
  for (const item of items.values()) {
    const node = item.node
    if (!node) continue
    if (node.kind === 'ref') {
      const { x, y, w, h } = item
      parts.push(`<rect class="rf" x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="none" stroke="#9aa1ab" stroke-width="1.4" stroke-dasharray="4 3"/>`)
      const tspans = item.lines.map((line, i) => `<tspan x="${n(x)}" y="${n(y + 6 + FONT * 0.95 + i * LINE)}">${escape(line)}</tspan>`).join('')
      parts.push(`<text class="m" text-anchor="middle" fill="#59636e">${tspans}</text>`)
      continue
    }
    const kind = LIGHT[node.kind] ? node.kind : 'step'
    const [fill, stroke] = LIGHT[kind] ?? ['#f3f4f6', '#8b95a5']
    const { x, y, w, h } = item
    const attrs = `class="s ${kind}" fill="${fill}" stroke="${stroke}" stroke-width="2"`
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
  }

  // 推開後的標籤可能超出原本的畫布，左右各補一點空間。
  const minX = Math.min(0, ...tags.map(tag => tag.x - tag.w / 2 - 4))
  const maxX = Math.max(layout.width, ...tags.map(tag => tag.x + tag.w / 2 + 4))
  const width = Math.ceil(maxX - minX)
  const dark = Object.entries(DARK).map(([kind, [fill, stroke]]) => `.s.${kind}{fill:${fill};stroke:${stroke}}`).join('')
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} 0 ${width} ${layout.height}" width="${width}" height="${layout.height}" font-family="-apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif" font-size="${FONT}">`,
    `<style>@media (prefers-color-scheme: dark){${dark}.t{fill:#e6e6e6}.e{stroke:#6b7280}.ah{fill:#6b7280}.lb rect{fill:#1e2128}.lb text{fill:#9aa4b2}.m{fill:#9aa4b2}.rf{stroke:#6b7280}}</style>`,
    '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z" fill="#9aa1ab"/></marker></defs>',
    ...parts,
    ...tags.map(drawTag),
    '</svg>',
  ].join('')
  return { source, width, height: layout.height }
}
