export type ServerInstallationKind = 'npm' | 'container' | 'source'

export type ServerUpdateInfo = {
  installation: ServerInstallationKind
  currentVersion: string
  command: string
  restartNote: string
  releaseUrl: string
}
