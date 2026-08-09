import type { GitHubExtensionHostServices } from './host-contract.ts'

export type GitHubContext = {
  run: (command: string, args: string[], options?: { input?: string }) => Promise<string>
  host: GitHubExtensionHostServices
  fetch?: typeof globalThis.fetch
  authenticationRefreshMs?: number
}

export type PullRequestActionInput = {
  repository: string
  pull_number: number
  head_sha: string
  comment?: string
}
