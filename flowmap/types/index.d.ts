export type FlowNode = { id: string; label: string; kind: string }
export type FlowEdge = { from: string; to: string; label: string }
export type FlowMap = {
  summary: string
  mermaid: string
  diagram: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  outline: string[]
  at: number
  turn: number
}
// 每則回應的圖解狀態：判斷中、詢問要不要看、按了要看但還在產生、已顯示、不需要畫。
export type FlowView = { turn: number; state: 'judging' | 'offer' | 'wanted' | 'shown' | 'skipped' }

declare module 'claude-code' {
  interface PluginState {
    flowmap: { map: FlowMap | null; isBusy: boolean; isAuto: boolean; isWeb: boolean; browser: string | null; lastAnswer: string; view: FlowView | null }
  }
}
