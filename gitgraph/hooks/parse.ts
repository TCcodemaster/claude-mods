import type { Commit } from '../types'

export const FORMAT = '%x01%h%x02%D%x02%s%x02%an%x02%ad'
export const DATE_FORMAT = '%m/%d %a %H:%M'
export const LIMIT = 40

const STAT = /(\d+) files? changed/

// 解析 git log --graph --shortstat：\x01 前是線圖；統計行歸給上一個提交。
export function parseLog(stdout: string): Commit[] {
  const out: Commit[] = []
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('\x01')
    if (at >= 0) {
      const [hash = '', refs = '', subject = '', author = '', date = ''] = line.slice(at + 1).split('\x02')
      out.push({ graph: line.slice(0, at), hash, refs: refs === '' ? [] : refs.split(', '), subject, author, date, files: 0 })
      continue
    }
    const stat = STAT.exec(line)
    if (stat) {
      const last = [...out].reverse().find(commit => commit.hash !== '')
      if (last) last.files = Number(stat[1])
      continue
    }
    // 只保留有分岔或合併的線圖行；純直線行由每個提交的第二行接續。
    if (/[\\/_]/.test(line)) {
      out.push({ graph: line.trimEnd(), hash: '', refs: [], subject: '', author: '', date: '', files: 0 })
    }
  }
  return out
}

// 解析 git status --porcelain=v1 -b：第一行是分支與追蹤狀態，其餘每行一個變更檔案。
export function parseStatus(stdout: string): { branch: string; tracking: string; dirty: number } {
  const [head = '', ...rest] = stdout.split('\n').filter(line => line !== '')
  const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.+)\])?/.exec(head)
  const ahead = /ahead (\d+)/.exec(m?.[3] ?? '')?.[1]
  const behind = /behind (\d+)/.exec(m?.[3] ?? '')?.[1]
  const tracking = [m?.[2] ?? '', ahead ? `領先 ${ahead}` : '', behind ? `落後 ${behind}` : '']
    .filter(Boolean)
    .join('  ')
  return { branch: m?.[1] ?? '', tracking, dirty: rest.length }
}

// 線圖字元換成框線字元，提交點用實心圓。
export function laneText(graph: string): string {
  return graph.replace(/\*/g, '●').replace(/\|/g, '│').replace(/\//g, '╱').replace(/\\/g, '╲').replace(/_/g, '─')
}

// 提交第二行的線圖：提交點那欄接成直線，斜線不延續。
export function continuation(graph: string): string {
  return graph.replace(/[*|]/g, '│').replace(/[\\/_]/g, ' ')
}

// 每兩欄是一條分支線，依欄位輪流上色。
export const LANE_COLORS = ['suggestion', 'success', 'warning', 'claude', 'error'] as const

export function laneSegments(text: string): { text: string; color: string | undefined }[] {
  const out: { text: string; color: string | undefined }[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ' '
    const color = ch === ' ' ? undefined : LANE_COLORS[Math.floor(i / 2) % LANE_COLORS.length]
    const last = out[out.length - 1]
    if (last && last.color === color) last.text += ch
    else out.push({ text: ch, color })
  }
  return out
}

// 標籤膠囊：HEAD 指向的分支、本地分支、tag、遠端分支各用一種底色。
export function pill(ref: string): { text: string; background: string } {
  if (ref.startsWith('HEAD -> ')) return { text: ref.slice(8), background: 'suggestion' }
  if (ref === 'HEAD') return { text: 'HEAD', background: 'suggestion' }
  if (ref.startsWith('tag: ')) return { text: ref.slice(5), background: 'warning' }
  if (ref.includes('/')) return { text: ref, background: 'subtle' }
  return { text: ref, background: 'success' }
}

// 要看的分支：空陣列代表全部分支。
export function logArgs(selected: readonly string[]): string[] {
  return selected.length === 0 ? ['--all'] : [...selected]
}
