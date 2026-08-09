#!/usr/bin/env node
import { spawn } from 'node:child_process'
import electron from 'electron'

const child = spawn(electron, ['.'], { cwd: new URL('..', import.meta.url), stdio: 'inherit' })
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
