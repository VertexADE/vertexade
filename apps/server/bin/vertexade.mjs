#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist', import.meta.url))
const apiPort = String(process.env.API_PORT || 4174)
const webPort = String(process.env.PORT || 4173)
const vertexHome = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(homedir(), '.vertex-ade')
const children = [
  spawn(process.execPath, [join(root, 'api.mjs')], {
    env: {
      ...process.env,
      APP_ROOT: join(root, 'runtime'),
      API_HOST: process.env.API_HOST || '127.0.0.1',
      API_PORT: apiPort,
      VERTEXADE_DATA_DIR: process.env.VERTEXADE_DATA_DIR || vertexHome,
      VERTEXADE_WORKTREE_ROOT: process.env.VERTEXADE_WORKTREE_ROOT || join(vertexHome, 'worktrees'),
    },
    stdio: 'inherit',
  }),
  spawn(process.execPath, [join(root, 'web/server/index.mjs')], {
    env: {
      ...process.env,
      HOST: process.env.HOST || '127.0.0.1',
      PORT: webPort,
      VERTEXADE_API_URL: process.env.VERTEXADE_API_URL || `http://127.0.0.1:${apiPort}`,
    },
    stdio: 'inherit',
  }),
]

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal))
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1
      stop('SIGTERM')
    }
  })
}
