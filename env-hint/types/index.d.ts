export type Env = {
  machine: string | null
  folder: string
  branch: string | null
  // 未提交的檔案數（含未追蹤的新檔）
  changes: number
  // 超前上游、尚未推送的提交數；沒有設定上游時為 null
  unpushed: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'env-hint': { env: Shaped<Env | null> }
  }
}
