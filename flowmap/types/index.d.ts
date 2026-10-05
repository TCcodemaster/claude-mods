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
}

declare module 'claude-code' {
  interface PluginState {
    flowmap: { map: FlowMap | null; isBusy: boolean; isAuto: boolean; isWeb: boolean; browser: string | null; lastAnswer: string }
  }
}
