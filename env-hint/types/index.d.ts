export type Env = { machine: string | null; folder: string; branch: string | null }

declare module 'claude-code' {
  interface PluginState {
    'env-hint': { env: Shaped<Env | null> }
  }
}
