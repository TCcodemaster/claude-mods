import { DARK, escape, LIGHT, n, textWidth, wrapLabel } from './svg'

// 桌面版面板畫不了 Mermaid，時序圖與時間軸在這裡自己解析、自己排版成 SVG。
// 只認常見語法；解析不出內容就回傳 null，面板改列大綱。

export type Drawn = { source: string; width: number; height: number }

const FONT = 15
const SMALL = 13
const LINE = 18
const MARGIN = 16
const FONT_FAMILY = `-apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif`
const MUTED = '#59636e'
const INK = '#1f2328'
const RULE = '#9aa1ab'

// 每行文字畫成置中或靠左的 tspan；<br> 視為換行。
const linesOf = (text: string, max: number) =>
  text.split(/<br\s*\/?>/i).flatMap(part => wrapLabel(part.trim(), max))
const widthOf = (lines: string[], size = FONT) => Math.max(0, ...lines.map(line => textWidth(line) * (size / FONT)))
const tspans = (lines: string[], x: number, y: number, size: number, step = LINE) =>
  lines.map((line, i) => `<tspan x="${n(x)}" y="${n(y + size * 0.95 + i * step)}">${escape(line)}</tspan>`).join('')

function wrapSvg(width: number, height: number, style: string, body: string[]): Drawn {
  const dark = Object.entries(DARK).map(([kind, [fill, stroke]]) => `.s.${kind}{fill:${fill};stroke:${stroke}}`).join('')
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT_FAMILY}" font-size="${FONT}">`,
    `<style>@media (prefers-color-scheme: dark){${dark}.t{fill:#e6e6e6}.m{fill:#9aa4b2}.e{stroke:#6b7280}.ah{fill:#6b7280}.bg{fill:#1e2128}${style}}</style>`,
    `<defs><marker id="sa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z" fill="${RULE}"/></marker>`,
    `<marker id="so" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="e" d="M0,0 L10,5 L0,10" fill="none" stroke="${RULE}" stroke-width="1.5"/></marker>`,
    `<marker id="sx" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9"><path class="e" d="M1,1 L9,9 M9,1 L1,9" stroke="${RULE}" stroke-width="1.8"/></marker></defs>`,
    ...body,
    '</svg>',
  ].join('')
  return { source, width: Math.ceil(width), height: Math.ceil(height) }
}

// ── 時序圖 ──────────────────────────────────────────────

type Party = { id: string; label: string; isActor: boolean }
type Step =
  | { kind: 'msg'; from: string; to: string; text: string; isDashed: boolean; head: 'arrow' | 'open' | 'cross' | 'none' }
  | { kind: 'note'; side: 'over' | 'left' | 'right'; on: string[]; text: string }
  | { kind: 'open'; keyword: string; text: string }
  | { kind: 'else'; keyword: string; text: string }
  | { kind: 'end' }

const ARROWS: Record<string, { isDashed: boolean; head: 'arrow' | 'open' | 'cross' | 'none' }> = {
  '->>': { isDashed: false, head: 'arrow' },
  '-->>': { isDashed: true, head: 'arrow' },
  '->': { isDashed: false, head: 'none' },
  '-->': { isDashed: true, head: 'none' },
  '-x': { isDashed: false, head: 'cross' },
  '--x': { isDashed: true, head: 'cross' },
  '-)': { isDashed: false, head: 'open' },
  '--)': { isDashed: true, head: 'open' },
}

export function parseSequence(mermaid: string): { parties: Party[]; steps: Step[] } | null {
  const parties: Party[] = []
  const steps: Step[] = []
  const blocks: string[] = []
  const party = (id: string, label = id, isActor = false) => {
    const found = parties.find(p => p.id === id)
    if (found) {
      if (label !== id) found.label = label
      if (isActor) found.isActor = true
      return
    }
    parties.push({ id, label, isActor })
  }
  for (const raw of mermaid.split('\n').slice(1)) {
    const line = raw.trim().replace(/;$/, '')
    if (line === '' || line.startsWith('%%') || /^(autonumber|activate|deactivate|title|links?|properties|create)\b/i.test(line)) continue
    const decl = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line)
    if (decl) {
      const id = (decl[2] ?? '').replace(/^"|"$/g, '')
      party(id, (decl[3] ?? id).replace(/^"|"$/g, ''), decl[1]?.toLowerCase() === 'actor')
      continue
    }
    const note = /^note\s+(over|left of|right of)\s+([^:]+?)\s*:\s*(.*)$/i.exec(line)
    if (note) {
      const on = (note[2] ?? '').split(',').map(id => id.trim()).filter(Boolean)
      on.forEach(id => party(id))
      const where = (note[1] ?? '').toLowerCase()
      steps.push({ kind: 'note', side: where === 'over' ? 'over' : where.startsWith('left') ? 'left' : 'right', on, text: note[3] ?? '' })
      continue
    }
    const open = /^(alt|opt|loop|par|critical|break|rect|box)\b\s*(.*)$/i.exec(line)
    if (open) {
      const keyword = (open[1] ?? '').toLowerCase()
      blocks.push(keyword)
      // rect 與 box 只是底色或分組，不畫框，但要吃掉對應的 end。
      if (keyword !== 'rect' && keyword !== 'box') steps.push({ kind: 'open', keyword, text: open[2] ?? '' })
      continue
    }
    const other = /^(else|and|option)\b\s*(.*)$/i.exec(line)
    if (other) {
      steps.push({ kind: 'else', keyword: (other[1] ?? '').toLowerCase(), text: other[2] ?? '' })
      continue
    }
    if (/^end$/i.test(line)) {
      const keyword = blocks.pop()
      if (keyword !== undefined && keyword !== 'rect' && keyword !== 'box') steps.push({ kind: 'end' })
      continue
    }
    const msg = /^(.+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*(.+?)\s*:\s*(.*)$/.exec(line)
    if (msg) {
      const from = (msg[1] ?? '').trim()
      const to = (msg[3] ?? '').trim()
      party(from)
      party(to)
      const style = ARROWS[msg[2] ?? '->>'] ?? { isDashed: false, head: 'arrow' as const }
      steps.push({ kind: 'msg', from, to, text: msg[4] ?? '', ...style })
    }
  }
  // 沒有對應 end 的區塊在最後補上。
  for (const keyword of blocks) if (keyword !== 'rect' && keyword !== 'box') steps.push({ kind: 'end' })
  return parties.length > 0 && steps.some(step => step.kind === 'msg') ? { parties, steps } : null
}

const BLOCK_NAMES: Record<string, string> = { alt: '條件', opt: '選擇性', loop: '重複', par: '同時', critical: '關鍵', break: '中斷' }

export function drawSequence(mermaid: string): Drawn | null {
  const parsed = parseSequence(mermaid)
  if (!parsed) return null
  const { parties, steps } = parsed
  const col = new Map(parties.map((p, i) => [p.id, i]))
  const boxLines = parties.map(p => linesOf(p.label, 120))
  const boxW = boxLines.map(lines => Math.max(84, widthOf(lines) + 24))
  const boxH = Math.max(...boxLines.map(lines => lines.length * LINE + 16))

  // 欄距：至少放得下相鄰兩個方框，再依跨過的訊息文字寬度撐開。
  const gaps = parties.slice(1).map((_, i) => ((boxW[i] ?? 0) + (boxW[i + 1] ?? 0)) / 2 + 28)
  let selfRoom = 0
  const msgLines = new Map<Step, string[]>()
  for (const step of steps) {
    if (step.kind !== 'msg') continue
    const a = col.get(step.from) ?? 0
    const b = col.get(step.to) ?? 0
    const lines = linesOf(step.text, 220)
    msgLines.set(step, lines)
    const need = widthOf(lines, SMALL) + 28
    if (a === b) {
      if (a < gaps.length) gaps[a] = Math.max(gaps[a] ?? 0, need + 30)
      else selfRoom = Math.max(selfRoom, need + 30)
      continue
    }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0)
    if (have < need) for (let k = lo; k < hi; k += 1) gaps[k] = (gaps[k] ?? 0) + (need - have) / (hi - lo)
  }
  const xs: number[] = []
  let x = MARGIN + (boxW[0] ?? 0) / 2
  parties.forEach((_, i) => {
    xs.push(x)
    x += gaps[i] ?? 0
  })
  const leftEdge = MARGIN
  const rightEdge = (xs.at(-1) ?? 0) + (boxW.at(-1) ?? 0) / 2 + Math.max(MARGIN, selfRoom)

  const body: string[] = []
  const front: string[] = []
  let y = MARGIN + boxH + 22
  const frames: { top: number; keyword: string; text: string; depth: number; splits: { y: number; text: string }[] }[] = []

  for (const step of steps) {
    if (step.kind === 'msg') {
      const a = xs[col.get(step.from) ?? 0] ?? 0
      const b = xs[col.get(step.to) ?? 0] ?? 0
      const lines = msgLines.get(step) ?? []
      const marker = step.head === 'arrow' ? 'url(#sa)' : step.head === 'open' ? 'url(#so)' : step.head === 'cross' ? 'url(#sx)' : ''
      const dash = step.isDashed ? ' stroke-dasharray="6 4"' : ''
      const end = marker === '' ? '' : ` marker-end="${marker}"`
      if (a === b) {
        front.push(`<text class="m" font-size="${SMALL}" fill="${MUTED}">${tspans(lines, a + 12, y, SMALL, 16)}</text>`)
        y += lines.length * 16 + 6
        body.push(`<path class="e" d="M${n(a)},${n(y)} H${n(a + 34)} V${n(y + 22)} H${n(a + 2)}" fill="none" stroke="${RULE}" stroke-width="1.6"${dash}${end}/>`)
        y += 22 + 22
        continue
      }
      front.push(`<text class="m" font-size="${SMALL}" text-anchor="middle" fill="${MUTED}">${tspans(lines, (a + b) / 2, y, SMALL, 16)}</text>`)
      y += lines.length * 16 + 6
      const tip = b > a ? b - 2 : b + 2
      body.push(`<path class="e" d="M${n(a)},${n(y)} H${n(tip)}" fill="none" stroke="${RULE}" stroke-width="1.6"${dash}${end}/>`)
      y += 26
      continue
    }
    if (step.kind === 'note') {
      const ids = step.on.map(id => xs[col.get(id) ?? 0] ?? 0)
      const lines = linesOf(step.text, 200)
      const w = Math.max(widthOf(lines, SMALL) + 20, step.side === 'over' && ids.length > 1 ? Math.max(...ids) - Math.min(...ids) + 60 : 0)
      const h = lines.length * 16 + 12
      const anchor = step.side === 'over' ? (Math.min(...ids) + Math.max(...ids)) / 2 : ids[0] ?? 0
      const left = step.side === 'over' ? anchor - w / 2 : step.side === 'left' ? anchor - 12 - w : anchor + 12
      const [fill, stroke] = LIGHT.decide ?? ['#fff4d6', '#d99a00']
      front.push(`<rect class="s decide" x="${n(left)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`)
      front.push(`<text class="t" font-size="${SMALL}" text-anchor="middle" fill="${INK}">${tspans(lines, left + w / 2, y + 6, SMALL, 16)}</text>`)
      y += h + 14
      continue
    }
    if (step.kind === 'open') {
      frames.push({ top: y, keyword: step.keyword, text: step.text, depth: frames.length, splits: [] })
      y += 30
      continue
    }
    if (step.kind === 'else') {
      frames.at(-1)?.splits.push({ y, text: step.text })
      y += 26
      continue
    }
    const frame = frames.pop()
    if (!frame) continue
    // 區塊框：左上角是種類與條件，else 用虛線分隔。
    const inset = frame.depth * 6
    const fx = leftEdge + inset
    const fw = rightEdge - leftEdge - inset * 2
    const bottom = y + 2
    body.push(`<rect class="e" x="${n(fx)}" y="${n(frame.top)}" width="${n(fw)}" height="${n(bottom - frame.top)}" rx="4" fill="none" stroke="${RULE}" stroke-width="1.2"/>`)
    const tag = BLOCK_NAMES[frame.keyword] ?? frame.keyword
    const tagW = textWidth(tag) * (SMALL / FONT) + 14
    front.push(`<path class="s step" d="M${n(fx)},${n(frame.top)} h${n(tagW)} v14 l-6,6 h${n(-tagW + 6)} z" fill="${LIGHT.step?.[0] ?? '#f3f4f6'}" stroke="${RULE}" stroke-width="1.2"/>`)
    front.push(`<text class="t" font-size="${SMALL}" font-weight="600" fill="${INK}" x="${n(fx + 6)}" y="${n(frame.top + 15)}">${escape(tag)}</text>`)
    if (frame.text !== '') front.push(`<text class="m" font-size="${SMALL}" fill="${MUTED}" x="${n(fx + tagW + 8)}" y="${n(frame.top + 15)}">${escape(`[${frame.text}]`)}</text>`)
    for (const split of frame.splits) {
      body.push(`<path class="e" d="M${n(fx)},${n(split.y)} H${n(fx + fw)}" stroke="${RULE}" stroke-width="1.2" stroke-dasharray="5 4"/>`)
      if (split.text !== '') front.push(`<text class="m" font-size="${SMALL}" fill="${MUTED}" x="${n(fx + 8)}" y="${n(split.y + 16)}">${escape(`[${split.text}]`)}</text>`)
    }
    y += 16
  }

  // 參與者方框在頂端，生命線一路往下。
  const bottom = y
  const heads: string[] = []
  parties.forEach((p, i) => {
    const cx = xs[i] ?? 0
    const w = boxW[i] ?? 84
    const [fill, stroke] = LIGHT.start ?? ['#e3efff', '#2f6fde']
    body.unshift(`<path class="e" d="M${n(cx)},${n(MARGIN + boxH)} V${n(bottom)}" stroke="${RULE}" stroke-width="1.2" stroke-dasharray="4 4"/>`)
    heads.push(`<rect class="s start" x="${n(cx - w / 2)}" y="${MARGIN}" width="${n(w)}" height="${n(boxH)}" rx="${p.isActor ? n(boxH / 2) : 6}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`)
    const lines = boxLines[i] ?? []
    heads.push(`<text class="t" text-anchor="middle" font-weight="600" fill="${INK}">${tspans(lines, cx, MARGIN + (boxH - lines.length * LINE) / 2, FONT)}</text>`)
  })
  return wrapSvg(rightEdge + MARGIN, bottom + MARGIN, '', [...body, ...heads, ...front])
}

// ── 時間軸 ──────────────────────────────────────────────

type Period = { label: string; events: string[]; section: number }

export function parseTimeline(mermaid: string): { title: string; sections: string[]; periods: Period[] } | null {
  let title = ''
  const sections: string[] = []
  const periods: Period[] = []
  for (const raw of mermaid.split('\n').slice(1)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('%%')) continue
    const head = /^(title|section)\s+(.+)$/i.exec(line)
    if (head) {
      if (head[1]?.toLowerCase() === 'title') title = head[2] ?? ''
      else sections.push(head[2] ?? '')
      continue
    }
    // 「時期 : 事件 : 事件」；只有冒號開頭的一行接在上一個時期後面。冒號兩側沒空白時退回第一個冒號。
    const parts = / : |^: /.test(line) || line.startsWith(':') ? line.split(/\s*:\s+|^:\s*/) : line.split(/:(.*)/s).slice(0, 2)
    const [label = '', ...events] = parts.map(part => part.trim())
    const clean = events.filter(Boolean)
    const last = periods.at(-1)
    if (label === '' && last) last.events.push(...clean)
    else if (label !== '') periods.push({ label, events: clean, section: sections.length - 1 })
  }
  return periods.length > 0 ? { title, sections, periods } : null
}

const SECTION_COLORS = ['start', 'done', 'decide', 'warn', 'step']

// 直式時間軸：面板窄，時期由上往下排，事件放在右邊的卡片裡。
export function drawTimeline(mermaid: string): Drawn | null {
  const parsed = parseTimeline(mermaid)
  if (!parsed) return null
  const width = 460
  const axis = MARGIN + 10
  const textX = axis + 22
  const room = width - textX - MARGIN
  const body: string[] = []
  let y = MARGIN
  if (parsed.title !== '') {
    const lines = linesOf(parsed.title, room + 20)
    body.push(`<text class="t" font-size="17" font-weight="700" fill="${INK}">${tspans(lines, MARGIN, y, 17, 22)}</text>`)
    y += lines.length * 22 + 14
  }
  const top = y
  let section = -2
  for (const period of parsed.periods) {
    const kind = SECTION_COLORS[(Math.max(0, period.section) % SECTION_COLORS.length)] ?? 'start'
    const [fill, stroke] = LIGHT[kind] ?? ['#e3efff', '#2f6fde']
    if (period.section !== section && period.section >= 0) {
      section = period.section
      const name = parsed.sections[section] ?? ''
      const w = textWidth(name) * (SMALL / FONT) + 18
      body.push(`<rect class="s ${kind}" x="${n(textX)}" y="${n(y)}" width="${n(w)}" height="22" rx="11" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`)
      body.push(`<text class="t" font-size="${SMALL}" font-weight="600" text-anchor="middle" fill="${INK}" x="${n(textX + w / 2)}" y="${n(y + 15.5)}">${escape(name)}</text>`)
      y += 32
    }
    section = period.section
    body.push(`<circle class="s ${kind}" cx="${n(axis)}" cy="${n(y + 11)}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`)
    const label = linesOf(period.label, room)
    body.push(`<text class="t" font-weight="700" fill="${INK}">${tspans(label, textX, y + 1, FONT, 20)}</text>`)
    y += label.length * 20 + 8
    for (const event of period.events) {
      const lines = linesOf(event, room - 22)
      const h = lines.length * 18 + 12
      body.push(`<rect class="bg" x="${n(textX)}" y="${n(y)}" width="${n(room)}" height="${n(h)}" rx="6" fill="#f6f8fa"/>`)
      body.push(`<rect x="${n(textX)}" y="${n(y)}" width="4" height="${n(h)}" rx="2" fill="${stroke}"/>`)
      body.push(`<text class="t" font-size="14" fill="${INK}">${tspans(lines, textX + 14, y + 5, 14, 18)}</text>`)
      y += h + 6
    }
    y += 14
  }
  body.unshift(`<path class="e" d="M${n(axis)},${n(top + 4)} V${n(y - 14)}" stroke="${RULE}" stroke-width="2"/>`)
  return wrapSvg(width, y - 14 + MARGIN, '', body)
}
