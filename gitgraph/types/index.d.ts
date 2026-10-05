export type Commit = {
  graph: string
  hash: string
  refs: string[]
  subject: string
  author: string
  date: string
  files: number
}
export type GitView = {
  branch: string
  tracking: string
  dirty: number
  branches: string[]
  commits: Commit[]
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    gitgraph: { view: GitView | null; selected: string[] }
  }
}
