import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseAgentThreadArguments, type AgentThreadOptions } from '@vertexade/platform-server/agents'

type Options = AgentThreadOptions

type ControlCommand = { type?: unknown; command_id?: unknown; prompt?: unknown }

function mcpConfiguration() {
  let values: any[] = []
  try {
    values = JSON.parse(process.env.VERTEXADE_MCP_SERVERS || '[]')
  } catch {
    throw new Error('Invalid Claude Code MCP configuration')
  }
  return {
    mcpServers: Object.fromEntries(
      values.map((server) => [
        server.name,
        server.transport === 'sse'
          ? { type: 'sse', url: server.url, headers: server.headers || {} }
          : { command: server.command, args: server.args || [], env: server.env || {} },
      ]),
    ),
  }
}

function emit(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`)
}

function userMessage(text: string) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

function messageText(message: unknown) {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? [String((part as { text?: unknown }).text || '')]
        : [],
    )
    .join('\n')
}

function withReasoningEffort(event: Record<string, unknown>, fallback: string | null | undefined) {
  const reasoningEffort = [event.reasoning_effort, event.reasoningEffort, event.effort, fallback].find(Boolean)
  return { reasoning_effort: reasoningEffort, ...event }
}

async function run(configuration: Options) {
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages']
  const mcp = mcpConfiguration()
  args.push('--mcp-config', JSON.stringify(mcp), '--strict-mcp-config')
  if (configuration.fork) args.push('--resume', configuration.fork, '--fork-session')
  else if (configuration.resume) args.push('--resume', configuration.resume)
  if (configuration.model) args.push('--model', configuration.model)
  if (configuration.reasoningEffort) args.push('--effort', configuration.reasoningEffort)
  if (configuration.ephemeral || configuration.permissionMode === 'read-only') args.push('--no-session-persistence')
  if (configuration.allowSubagents) args.push('--forward-subagent-text')
  else args.push('--disallowedTools', 'Agent', 'Task')
  if (configuration.permissionMode === 'read-only') {
    args.push('--permission-mode', 'plan', '--tools', '', '--safe-mode')
  } else {
    args.push('--dangerously-skip-permissions')
  }

  const child = spawn('claude', args, {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map<string, { commandId: string; prompt: string }>()
  let inputClosed = false
  const closeInput = () => {
    if (inputClosed) return
    inputClosed = true
    child.stdin.end()
  }
  const terminate = () => child.kill('SIGTERM')
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)

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
    if (!commandId || !prompt || inputClosed || !child.stdin.writable) {
      emit({
        event: 'steer_rejected',
        command_id: commandId,
        message: 'The active Claude Code turn is no longer available to steer',
      })
      return
    }
    pending.set(commandId, { commandId, prompt })
    child.stdin.write(`${userMessage(prompt)}\n`, (error) => {
      if (!error) return
      pending.delete(commandId)
      emit({ event: 'steer_rejected', command_id: commandId, message: error.message })
    })
  })

  createInterface({ input: child.stdout }).on('line', (line) => {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      process.stdout.write(`${line}\n`)
      return
    }
    emit(withReasoningEffort(event, configuration.reasoningEffort))
    if (event.type === 'user' && event.isReplay === true) {
      const text = messageText(event.message)
      for (const [commandId, command] of pending) {
        if (command.prompt !== text) continue
        pending.delete(commandId)
        emit({
          event: 'steer_accepted',
          command_id: commandId,
          session_id: event.session_id || null,
        })
        break
      }
    }
    if (event.type === 'result') closeInput()
  })

  if (configuration.prompt) child.stdin.write(`${userMessage(configuration.prompt)}\n`)
  else closeInput()

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
  process.removeListener('SIGINT', terminate)
  process.removeListener('SIGTERM', terminate)
  inputCommands.close()
  for (const { commandId } of pending.values()) {
    emit({
      event: 'steer_rejected',
      command_id: commandId,
      message: 'Claude Code ended before accepting the steering message',
    })
  }
  process.exitCode = exitCode
}

run(parseAgentThreadArguments()).catch((error) => {
  emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
