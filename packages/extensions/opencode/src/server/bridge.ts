import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseAgentThreadArguments, type AgentThreadOptions } from '@vertexade/platform-server/agents'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { openCodeThreadContext } from './thread-context.ts'

type Options = AgentThreadOptions & { cwd: string }

type ControlCommand = { type?: unknown; command_id?: unknown; prompt?: unknown }

function emit(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function detectedThreadContext(threadId: string, configuration: Options) {
  let database: DatabaseSync | null = null
  try {
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    database = new DatabaseSync(join(dataHome, 'opencode', 'opencode.db'), { readOnly: true })
    const messages = database
      .prepare(`SELECT data FROM message WHERE session_id=?
      ORDER BY time_created DESC, id DESC LIMIT 20`)
      .all(threadId)
      .flatMap((row) => {
        try {
          return [JSON.parse(String((row as { data: string }).data))]
        } catch {
          return []
        }
      })
    return openCodeThreadContext(messages, {
      model: configuration.model ? String(configuration.model) : null,
      reasoning_effort: configuration.reasoningEffort ? String(configuration.reasoningEffort) : null,
    })
  } catch {
    return openCodeThreadContext([], {
      model: configuration.model ? String(configuration.model) : null,
      reasoning_effort: configuration.reasoningEffort ? String(configuration.reasoningEffort) : null,
    })
  } finally {
    database?.close()
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  if (!port) throw new Error('Could not allocate a local OpenCode server port')
  return port
}

async function waitForServer(baseUrl: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`OpenCode server exited with code ${child.exitCode}`)
    try {
      const response = await resilientFetch({
        service: 'OpenCode local server',
        fetch: globalThis.fetch,
        url: `${baseUrl}/doc`,
        timeoutMs: 500,
        attempts: 1,
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined)
      }, 50)
    })
  }
  throw new Error('OpenCode server did not become ready')
}

async function run(configuration: Options) {
  if (!configuration.cwd || !configuration.prompt) throw new Error('OpenCode bridge requires --cwd and --prompt')
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: configuration.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  server.stdout.pipe(process.stderr)
  server.stderr.pipe(process.stderr)
  let runner: ChildProcess | null = null
  const terminate = () => {
    runner?.kill('SIGTERM')
    server.kill('SIGTERM')
  }
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)

  try {
    await waitForServer(baseUrl, server)
    const args = ['run', '--attach', baseUrl, '--format', 'json', '--dir', configuration.cwd]
    if (configuration.permissionMode !== 'read-only') args.push('--auto')
    if (configuration.resume) args.push('--session', configuration.resume)
    if (configuration.fork) args.push('--session', configuration.fork, '--fork')
    if (configuration.model) args.push('--model', configuration.model)
    if (configuration.reasoningEffort) args.push('--variant', configuration.reasoningEffort)
    args.push(configuration.prompt)

    runner = spawn('opencode', args, {
      cwd: configuration.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    runner.stderr?.pipe(process.stderr)
    let sessionId = configuration.resume
    let completed = false
    let emittedContext = ''
    const emitThreadContext = (refresh = false) => {
      if (!sessionId) return
      if (emittedContext && !refresh) return
      const context = detectedThreadContext(sessionId, configuration)
      const serialized = JSON.stringify(context)
      if (serialized === emittedContext || (!context.model && !context.reasoning_effort)) return
      emittedContext = serialized
      emit({ event: 'thread_context_updated', thread_id: sessionId, ...context })
    }
    createInterface({ input: runner.stdout! }).on('line', (line) => {
      process.stdout.write(`${line}\n`)
      let event: Record<string, unknown>
      try {
        event = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      if (event.sessionID) sessionId = String(event.sessionID)
      emitThreadContext()
      if (event.type === 'step_finish' && String((event.part as { reason?: unknown } | undefined)?.reason || '') !== 'tool-calls') {
        completed = true
        emitThreadContext(true)
      }
    })

    const inputCommands = createInterface({ input: process.stdin })
    inputCommands.on('line', (line) => {
      let command: ControlCommand
      try {
        command = JSON.parse(line) as ControlCommand
      } catch {
        return
      }
      if (command.type !== 'steer') return
      const commandId = String(command.command_id || '')
      const prompt = String(command.prompt || '').trim()
      if (!commandId || !prompt || !sessionId || completed || runner?.exitCode !== null) {
        emit({
          event: 'steer_rejected',
          command_id: commandId,
          message: 'The active OpenCode turn is no longer available to steer',
        })
        return
      }
      void resilientFetch({
        service: 'OpenCode steering',
        fetch: globalThis.fetch,
        url: `${baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(configuration.cwd)}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
        },
        timeoutMs: 10_000,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`OpenCode rejected the steering message with HTTP ${response.status}`)
          emit({ event: 'steer_accepted', command_id: commandId, session_id: sessionId })
        })
        .catch((error) => {
          emit({
            event: 'steer_rejected',
            command_id: commandId,
            message: error instanceof Error ? error.message : String(error),
          })
        })
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      runner!.once('error', reject)
      runner!.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
    emitThreadContext(true)
    inputCommands.close()
    process.exitCode = exitCode
  } finally {
    process.removeListener('SIGINT', terminate)
    process.removeListener('SIGTERM', terminate)
    terminate()
  }
}

run(parseAgentThreadArguments({ cwd: true }) as Options).catch((error) => {
  emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
