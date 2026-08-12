import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { DESKTOP_ONBOARDING_CHANNELS } from '@vertexade/platform-contracts'
import { desktopRuntimeModeEnvironment, desktopServiceEnvironment } from './desktop-environment.ts'
import { DesktopOnboardingStateStore, desktopStartupPath } from './desktop-onboarding-state.ts'
import { canStartDesktopUpdater, startDesktopUpdater } from './desktop-updater.ts'
import updaterPackage from 'electron-updater'
import { externalNavigationDecision } from './external-navigation.ts'
import { desktopPermissionAllowed } from './desktop-permissions.ts'
import { localListenerUrl, selectDesktopListeners } from './desktop-listeners.ts'

const { autoUpdater } = updaterPackage

const services = new Set<ChildProcess>()
let desktopWindow: BrowserWindow | null = null
let windowStartup: Promise<void> | null = null
let stopUpdater: (() => void) | null = null
let onboardingStateStore: DesktopOnboardingStateStore | null = null

function resourcePath(...parts: string[]) {
  return join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'dist'), ...parts)
}

function preloadPath(): string {
  return join(app.getAppPath(), 'dist', 'preload.cjs')
}

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local port')
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return address.port
}

function startService(entry: string, environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [resourcePath('service-runner.mjs'), entry], {
    env: {
      ...process.env,
      ...environment,
      ELECTRON_RUN_AS_NODE: '1',
      VERTEXADE_DESKTOP_PARENT_PID: String(process.pid),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  services.add(child)
  child.stdout?.on('data', (data) => console.info(String(data).trimEnd()))
  child.stderr?.on('data', (data) => console.error(String(data).trimEnd()))
  child.once('exit', () => services.delete(child))
  return child
}

async function waitUntilReady(url: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Bundled service exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // The service is still starting.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }
  throw new Error(`Bundled service did not become ready: ${url}`)
}

function stopServices() {
  for (const child of services) child.kill('SIGTERM')
  services.clear()
}

async function createDesktopWindow() {
  const onboardingState = await requireOnboardingStateStore().read()
  const home = app.getPath('home')
  const serviceEnvironment = desktopServiceEnvironment(process.env, process.platform, home)
  const packagedEnvironment = desktopRuntimeModeEnvironment(app.isPackaged)
  const vertexHome = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(home, '.vertex-ade')
  const runtimeEnvironment = {
    ...serviceEnvironment,
    ...packagedEnvironment,
    VERTEXADE_DATA_DIR: vertexHome,
  }
  const listeners = await selectDesktopListeners(runtimeEnvironment, availablePort)
  const desktopApiListener = { ...listeners.api, host: '127.0.0.1' }
  const apiUrl = localListenerUrl(desktopApiListener)
  const webUrl = localListenerUrl(listeners.web)
  const localSessionToken = randomBytes(32).toString('base64url')
  const api = startService(resourcePath('api.mjs'), {
    ...runtimeEnvironment,
    APP_ROOT: resourcePath('runtime'),
    API_HOST: desktopApiListener.host,
    API_PORT: String(desktopApiListener.port),
    VERTEXADE_BUNDLED_RUNTIME: '1',
    VERTEXADE_API_LISTENER_SOURCE: listeners.source,
    VERTEXADE_SUBAGENT_MCP_SCRIPT: resourcePath('subagent-mcp.mjs'),
    VERTEXADE_WEB_CURRENT_HOST: listeners.web.host,
    VERTEXADE_WEB_CURRENT_PORT: String(listeners.web.port),
    VERTEXADE_WEB_LISTENER_SOURCE: listeners.source,
    VERTEXADE_WORKTREE_ROOT: process.env.VERTEXADE_WORKTREE_ROOT || join(vertexHome, 'worktrees'),
  })
  await waitUntilReady(`${apiUrl}/readyz`, api)

  const web = startService(resourcePath('web/server/index.mjs'), {
    ...runtimeEnvironment,
    HOST: listeners.web.host,
    PORT: String(listeners.web.port),
    VERTEXADE_API_URL: apiUrl,
    VERTEXADE_LOCAL_SESSION_TOKEN: localSessionToken,
    VERTEXADE_REQUIRE_PAIRED_CLIENTS: '1',
  })
  await waitUntilReady(webUrl, web)

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath(),
    },
  })
  desktopWindow = window
  const internalOrigin = new URL(webUrl).origin
  window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    let trusted = false
    try {
      trusted = new URL(details.url).origin === internalOrigin
    } catch {
      trusted = false
    }
    callback({
      requestHeaders: trusted ? { ...details.requestHeaders, 'x-vertexade-local-session': localSessionToken } : details.requestHeaders,
    })
  })
  window.once('closed', () => {
    desktopWindow = null
    stopServices()
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (externalNavigationDecision(url, webUrl) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (externalNavigationDecision(url, webUrl) !== 'internal') event.preventDefault()
  })
  window.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    desktopPermissionAllowed(
      {
        permission,
        requestingUrl: details.requestingUrl || requestingOrigin,
        isMainFrame: details.isMainFrame,
      },
      webUrl,
    ),
  )
  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(desktopPermissionAllowed({ permission, requestingUrl: details.requestingUrl, isMainFrame: details.isMainFrame }, webUrl))
  })
  await window.loadURL(new URL(desktopStartupPath(onboardingState), `${webUrl}/`).toString())
}

function requireOnboardingStateStore(): DesktopOnboardingStateStore {
  if (!onboardingStateStore) throw new Error('Desktop onboarding state is not initialized')
  return onboardingStateStore
}

function assertTrustedDesktopRenderer(event: IpcMainInvokeEvent): void {
  if (!desktopWindow || event.sender !== desktopWindow.webContents) throw new Error('Desktop renderer is not trusted')
}

function registerDesktopIpc(): void {
  ipcMain.handle(DESKTOP_ONBOARDING_CHANNELS.status, async (event) => {
    assertTrustedDesktopRenderer(event)
    return requireOnboardingStateStore().read()
  })
  ipcMain.handle(DESKTOP_ONBOARDING_CHANNELS.complete, async (event) => {
    assertTrustedDesktopRenderer(event)
    return requireOnboardingStateStore().complete()
  })
}

function ensureDesktopWindow(): Promise<void> {
  if (desktopWindow) {
    if (desktopWindow.isMinimized()) desktopWindow.restore()
    desktopWindow.focus()
    return Promise.resolve()
  }
  if (windowStartup) return windowStartup
  windowStartup = createDesktopWindow().finally(() => {
    windowStartup = null
  })
  return windowStartup
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  void ensureDesktopWindow().catch(showStartupError)
})
app.on('before-quit', stopServices)

async function showStartupError(error: unknown): Promise<void> {
  console.error(error)
  stopServices()
  await dialog.showMessageBox({
    type: 'error',
    title: 'VertexADE could not start',
    message: error instanceof Error ? error.message : String(error),
  })
  app.quit()
}

void app
  .whenReady()
  .then(async () => {
    onboardingStateStore = new DesktopOnboardingStateStore(app.getPath('userData'), {
      reportReadError: (error) => console.error('Desktop onboarding state could not be read', error),
    })
    registerDesktopIpc()
    await ensureDesktopWindow()
    const updaterEnabled = canStartDesktopUpdater({
      isPackaged: app.isPackaged,
      platform: process.platform,
      updatesDisabled: process.env.VERTEXADE_DISABLE_AUTO_UPDATE === '1',
      verifyMacSignature: () => {
        try {
          execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', resolve(process.execPath, '../../..')], { stdio: 'ignore' })
          return true
        } catch {
          return false
        }
      },
    })
    if (!updaterEnabled) return
    stopUpdater = startDesktopUpdater({
      updater: autoUpdater,
      logError: (error) => console.error('Desktop update failed', error),
      confirmInstall: async ({ version }) => {
        const prompt: MessageBoxOptions = {
          type: 'info',
          title: 'VertexADE update ready',
          message: `VertexADE ${version} has been downloaded.`,
          detail: `You are currently running ${app.getVersion()}. Restart now to install the update.`,
          buttons: ['Restart and install', 'Later'],
          defaultId: 0,
          cancelId: 1,
        }
        const result = desktopWindow ? await dialog.showMessageBox(desktopWindow, prompt) : await dialog.showMessageBox(prompt)
        return result.response === 0
      },
    })
  })
  .catch(showStartupError)

app.on('will-quit', () => {
  ipcMain.removeHandler(DESKTOP_ONBOARDING_CHANNELS.status)
  ipcMain.removeHandler(DESKTOP_ONBOARDING_CHANNELS.complete)
  stopUpdater?.()
  stopUpdater = null
})
