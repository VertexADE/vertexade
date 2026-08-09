import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

const services = new Set<ChildProcess>()

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
  const vertexHome = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(app.getPath('home'), '.vertex-ade')
  const api = startService(resourcePath('api.mjs'), {
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', stopServices)

void app
  .whenReady()
  .then(createDesktopWindow)
  .catch(async (error) => {
    console.error(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'VertexADE could not start',
      message: error instanceof Error ? error.message : String(error),
    })
    app.quit()
  })
