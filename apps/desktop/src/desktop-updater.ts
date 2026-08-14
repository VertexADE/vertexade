type UpdateInfo = { version: string }

export type DesktopUpdater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{ updateInfo?: UpdateInfo } | null | undefined>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type DesktopUpdaterOptions = {
  updater: DesktopUpdater
  confirmInstall(info: UpdateInfo): Promise<boolean>
  logError(error: unknown): void
  onDownloaded?(info: UpdateInfo): void
  initialDelayMs?: number
  intervalMs?: number
}

export type DesktopUpdateCheckState = {
  currentVersion: string
  downloadedVersion: string | null
}

export async function checkDesktopUpdater(updater: DesktopUpdater, state: DesktopUpdateCheckState) {
  try {
    const result = await updater.checkForUpdates()
    const availableVersion = result?.updateInfo?.version ?? null
    let updateState: 'current' | 'downloading' | 'ready' = 'current'
    if (availableVersion && availableVersion !== state.currentVersion) updateState = 'downloading'
    if (state.downloadedVersion) updateState = 'ready'
    return {
      state: updateState,
      availableVersion: state.downloadedVersion ?? availableVersion,
      message: state.downloadedVersion ? 'Update downloaded and ready to install.' : null,
    }
  } catch (error) {
    return {
      state: 'error' as const,
      availableVersion: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function canStartDesktopUpdater(options: {
  isPackaged: boolean
  platform: NodeJS.Platform
  updatesDisabled: boolean
  verifyMacSignature(): boolean
}) {
  if (!options.isPackaged || options.updatesDisabled) return false
  return options.platform !== 'darwin' || options.verifyMacSignature()
}

export function startDesktopUpdater(options: DesktopUpdaterOptions) {
  const { updater } = options
  let installPromptOpen = false
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('error', options.logError)
  updater.on('update-downloaded', (info) => {
    options.onDownloaded?.(info)
    if (installPromptOpen) return
    installPromptOpen = true
    void options
      .confirmInstall(info)
      .then((install) => {
        if (install) updater.quitAndInstall(false, true)
      })
      .catch(options.logError)
      .finally(() => {
        installPromptOpen = false
      })
  })

  const check = () => void updater.checkForUpdates().catch(options.logError)
  const initial = setTimeout(check, options.initialDelayMs ?? 15_000)
  const interval = setInterval(check, options.intervalMs ?? 4 * 60 * 60 * 1_000)
  initial.unref()
  interval.unref()
  return () => {
    clearTimeout(initial)
    clearInterval(interval)
  }
}
