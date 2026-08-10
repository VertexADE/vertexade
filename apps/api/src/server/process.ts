import { spawn, type SpawnOptions } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'

export type RunOptions = SpawnOptions & {
  input?: string
  includeStderr?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  onOutput?: (value: string, stream: 'stdout' | 'stderr') => void
}

export type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

function appendBounded(current: Buffer[], chunk: Buffer, state: { bytes: number }, limit: number) {
  state.bytes += chunk.length
  if (state.bytes > limit) throw new Error(`Command output exceeded ${limit} bytes`)
  current.push(chunk)
}

export function runCommandResult(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const {
      input,
      includeStderr: _includeStderr = false,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
      onOutput,
      ...spawnOptions
    } = options
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const output = { bytes: 0 }
    let settled = false
    let failure: Error | null = null
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const stop = (error: Error) => {
      if (failure) return
      failure = error
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 1_000)
      force.unref()
    }
    const timer = setTimeout(() => stop(new Error(`${command} timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
    if (input !== undefined) child.stdin.end(String(input))
    child.stdout.on('data', (value: Buffer) => {
      onOutput?.(value.toString('utf8'), 'stdout')
      try {
        appendBounded(stdout, value, output, maxOutputBytes)
      } catch (error) {
        stop(error as Error)
      }
    })
    child.stderr.on('data', (value: Buffer) => {
      onOutput?.(value.toString('utf8'), 'stderr')
      try {
        appendBounded(stderr, value, output, maxOutputBytes)
      } catch (error) {
        stop(error as Error)
      }
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) =>
      finish(() => {
        if (failure) return reject(failure)
        const stdoutText = Buffer.concat(stdout).toString('utf8')
        const stderrText = Buffer.concat(stderr).toString('utf8').trim()
        resolve({ stdout: stdoutText, stderr: stderrText, exitCode: code ?? -1 })
      }),
    )
  })
}

export async function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  const result = await runCommandResult(command, args, options)
  if (result.exitCode !== 0) throw new Error(result.stderr || `${command} exited with ${result.exitCode}`)
  return options.includeStderr ? [result.stdout, result.stderr].filter(Boolean).join('\n') : result.stdout
}

export async function processStartIdentity(pid: number | null | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return null
  if (process.platform !== 'linux') {
    try {
      const result = await runCommandResult('ps', ['-p', String(pid), '-o', 'lstart='], { timeoutMs: 2_000, maxOutputBytes: 10_000 })
      return result.exitCode === 0 ? result.stdout.trim() || null : null
    } catch {
      return null
    }
  }
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const closing = stat.lastIndexOf(')')
    if (closing < 0) return null
    return stat.slice(closing + 2).split(/\s+/)[19] || null
  } catch {
    return null
  }
}

export async function processWorkingDirectory(pid: number | null | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return null
  if (pid === process.pid) return realpath(process.cwd())
  if (process.platform !== 'linux') {
    try {
      const result = await runCommandResult('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        timeoutMs: 2_000,
        maxOutputBytes: 100_000,
      })
      const path = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith('n'))
        ?.slice(1)
      return path ? await realpath(path) : null
    } catch {
      return null
    }
  }
  try {
    return await realpath(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}
