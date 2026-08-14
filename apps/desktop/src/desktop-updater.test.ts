import { describe, expect, it, vi } from 'vite-plus/test'
import { canStartDesktopUpdater, checkDesktopUpdater, startDesktopUpdater, type DesktopUpdater } from './desktop-updater.ts'

function fakeUpdater() {
  const listeners = new Map<string, (value: never) => void>()
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (value: never) => void) => listeners.set(event, listener)),
  } as unknown as DesktopUpdater
  return { updater, listeners }
}

describe('desktop updater', () => {
  it('requires a valid signature for packaged macOS builds', () => {
    expect(canStartDesktopUpdater({ isPackaged: true, platform: 'darwin', updatesDisabled: false, verifyMacSignature: () => true })).toBe(
      true,
    )
    expect(canStartDesktopUpdater({ isPackaged: true, platform: 'darwin', updatesDisabled: false, verifyMacSignature: () => false })).toBe(
      false,
    )
    expect(canStartDesktopUpdater({ isPackaged: false, platform: 'darwin', updatesDisabled: false, verifyMacSignature: () => true })).toBe(
      false,
    )
  })

  it('checks packaged releases and installs a downloaded update after confirmation', async () => {
    vi.useFakeTimers()
    const { updater, listeners } = fakeUpdater()
    const confirmInstall = vi.fn(async () => true)
    const onDownloaded = vi.fn()
    const stop = startDesktopUpdater({ updater, confirmInstall, onDownloaded, logError: vi.fn(), initialDelayMs: 1 })

    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    listeners.get('update-downloaded')?.({ version: '0.0.12' } as never)
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true))
    expect(onDownloaded).toHaveBeenCalledWith({ version: '0.0.12' })
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    stop()
    vi.useRealTimers()
  })

  it('leaves a downloaded update pending when restart is declined', async () => {
    const { updater, listeners } = fakeUpdater()
    const stop = startDesktopUpdater({ updater, confirmInstall: async () => false, logError: vi.fn() })
    listeners.get('update-downloaded')?.({ version: '0.0.12' } as never)
    await Promise.resolve()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    stop()
  })

  it('reports manual update checks without installing automatically', async () => {
    const { updater } = fakeUpdater()
    vi.mocked(updater.checkForUpdates).mockResolvedValue({ updateInfo: { version: '0.0.34' } })

    await expect(checkDesktopUpdater(updater, { currentVersion: '0.0.33', downloadedVersion: null })).resolves.toEqual({
      state: 'downloading',
      availableVersion: '0.0.34',
      message: null,
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
})
