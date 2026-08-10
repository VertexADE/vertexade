import { app, BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { desktopServiceEnvironment } from './desktop-environment.ts'
import { canStartDesktopUpdater, startDesktopUpdater } from './desktop-updater.ts'
import updaterPackage from 'electron-updater'

const { autoUpdater } = updaterPackage

const services = new Set<ChildProcess>()
let desktopWindow: BrowserWindow | null = null
let windowStartup: Promise<void> | null = null
let stopUpdater: (() => void) | null = null

function resourcePath(...parts: string[]) {
  return join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'dist'), ...parts)
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
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...environment, ELECTRON_RUN_AS_NODE: '1' },
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
  const apiPort = await availablePort()
  const webPort = await availablePort()
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://127.0.0.1:${webPort}`
  const home = app.getPath('home')
  const serviceEnvironment = desktopServiceEnvironment(process.env, process.platform, home)
  const vertexHome = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(home, '.vertex-ade')
  const api = startService(resourcePath('api.mjs'), {
    ...serviceEnvironment,
    APP_ROOT: resourcePath('runtime'),
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    VERTEXADE_BUNDLED_RUNTIME: '1',
    VERTEXADE_SUBAGENT_MCP_SCRIPT: resourcePath('subagent-mcp.mjs'),
    VERTEXADE_DATA_DIR: vertexHome,
    VERTEXADE_WORKTREE_ROOT: process.env.VERTEXADE_WORKTREE_ROOT || join(vertexHome, 'worktrees'),
  })
  await waitUntilReady(`${apiUrl}/readyz`, api)

  const web = startService(resourcePath('web/server/index.mjs'), {
    ...serviceEnvironment,
    HOST: '127.0.0.1',
    PORT: String(webPort),
    VERTEXADE_API_URL: apiUrl,
  })
  await waitUntilReady(webUrl, web)

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  desktopWindow = window
  window.once('closed', () => {
    desktopWindow = null
    stopServices()
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== webUrl) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== webUrl) event.preventDefault()
  })
  await window.loadURL(webUrl)
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
  stopUpdater?.()
  stopUpdater = null
})
