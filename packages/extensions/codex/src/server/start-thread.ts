import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { codexTurnInput } from './input.ts'
import { completedMonitoredTurn, steerActiveTurn } from './turn-control.ts'
import { createInterface } from 'node:readline'
import WebSocket, { type RawData } from 'ws'
import { codexActionEvent } from './timeline.ts'

type JsonRecord = Record<string, unknown>
type RpcMessage = {
  id?: number | string
  method?: string
  result?: unknown
  error?: { message?: string }
  params?: {
    threadId?: string
    turnId?: string
    itemId?: string
    questions?: unknown[]
    autoResolutionMs?: number
    diff?: string
    item?: Record<string, unknown> & { type?: string; text?: string }
    turn?: { id?: string; status?: string }
    threadSettings?: { model?: string; effort?: string | null }
  }
}
type ThreadResponse = {
  thread: { id: string; runtimeWorkspaceRoots?: string[] }
  model?: string
  reasoningEffort?: string | null
  runtimeWorkspaceRoots?: string[]
}
type TurnResponse = { turn: { id: string } }
type TurnSteerResponse = { turnId: string }
type PendingRequest = {
  resolveRequest(value: unknown): void
  rejectRequest(reason?: unknown): void
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : process.argv[index + 1]
}

function options(name: string) {
  return process.argv.flatMap((value, index) => (value === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []))
}

const cwd = resolve(option('cwd') || '')
const base = resolve(option('base') || '')
const prompt = option('prompt')
const resumeId = option('resume')
const forkId = option('fork')
const model = option('model')
const reasoningEffort = option('reasoning-effort')
const serviceTier = option('service-tier')
const dryRun = process.argv.includes('--dry-run')
const reviewMode = process.argv.includes('--review-mode')
const fullAccess = process.argv.includes('--full-access')
const readOnly = process.argv.includes('--read-only')
const ephemeral = process.argv.includes('--ephemeral')
const allowSubagents = process.argv.includes('--allow-subagents')
const writableRoots = options('writable-root').map((path) => resolve(path))

function mcpConfig() {
  let values: any[] = []
  try {
    values = JSON.parse(process.env.VERTEXADE_MCP_SERVERS || '[]')
  } catch {
    throw new Error('Invalid Codex MCP configuration')
  }
  return Object.fromEntries(
    values.map((server) => [
      server.name,
      server.transport === 'sse'
        ? { url: server.url, http_headers: server.headers || {} }
        : { command: server.command, args: server.args || [], env: server.env || {} },
    ]),
  )
}

const configuredMcpServers = mcpConfig()
const threadConfig = {
  mcp_servers: configuredMcpServers,
  features: { multi_agent: allowSubagents },
}

if (!option('cwd') || !option('base') || (!prompt && !resumeId && !forkId) || (resumeId && forkId)) {
  console.error(
    'Usage: start-codex-thread.ts --cwd <worktree> --base <repository> --prompt <message> [--resume <thread-id> | --fork <thread-id>] [--review-mode] [--dry-run]',
  )
  process.exit(2)
}

// Codex-managed threads expose the worktree plus narrowly scoped host-owned
// writable roots such as the current Work item's shared memory directory.
const roots = [...new Set([cwd, ...writableRoots])]
const threadParams: Record<string, unknown> = {
  cwd,
  runtimeWorkspaceRoots: roots,
  threadSource: 'vertexade',
  ephemeral,
  ...(model ? { model } : {}),
  ...(serviceTier ? { serviceTier } : {}),
  config: threadConfig,
}
if (fullAccess) {
  threadParams.approvalPolicy = 'never'
  threadParams.sandbox = 'danger-full-access'
} else if (readOnly) {
  threadParams.approvalPolicy = 'never'
  threadParams.sandbox = 'read-only'
} else if (reviewMode) {
  threadParams.approvalPolicy = 'never'
  threadParams.sandbox = 'workspace-write'
}

function emit(event: string, details: JsonRecord = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }))
}

function threadResponseDetails(response: ThreadResponse) {
  return {
    runtime_workspace_roots: response.runtimeWorkspaceRoots ?? response.thread.runtimeWorkspaceRoots ?? roots,
    model: response.model ?? null,
    reasoning_effort: response.reasoningEffort ?? null,
  }
}

function settingsContextEvents(message: RpcMessage, currentThreadId: string | null) {
  if (message.method !== 'thread/settings/updated' || message.params?.threadId !== currentThreadId) return []
  return [
    {
      thread_id: currentThreadId,
      model: message.params.threadSettings?.model ?? null,
      reasoning_effort: message.params.threadSettings?.effort ?? null,
    },
  ]
}

function emitRequestedThreadContext(currentThreadId: string | null) {
  if (!model && !reasoningEffort) return
  emit('thread_context_updated', {
    thread_id: currentThreadId,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  })
}

if (dryRun) {
  emit('dry_run', { threadParams, prompt, resumeId, forkId, reasoningEffort, serviceTier: serviceTier || 'normal' })
  process.exit(0)
}

// Use the Codex app's persistent control server. A private stdio app-server can
// execute the turn, but the app sees that disconnected runtime as idle/stopped.
const socketPath = join(homedir(), '.codex', 'app-server-control', 'app-server-control.sock')
const appServer = new WebSocket(`ws+unix://${socketPath}:/`, { perMessageDeflate: false })
const connected = new Promise<void>((resolveConnection, rejectConnection) => {
  appServer.once('open', resolveConnection)
  appServer.once('error', rejectConnection)
})

let requestId = 0
const pending = new Map<number, PendingRequest>()
const inboundRequests = new Map<string, number | string>()
let threadId: string | null = null
let turnId: string | null = null
let monitoredTurnId: string | null = null
let completed = false
let expectCompletion = false
let latestDiff = ''
let diffTimer: ReturnType<typeof setTimeout> | null = null

function flushDiff() {
  if (!latestDiff) return
  emit('diff_updated', {
    thread_id: threadId,
    turn_id: turnId || monitoredTurnId,
    diff: latestDiff,
  })
  latestDiff = ''
  diffTimer = null
}

function send(message: unknown) {
  appServer.send(JSON.stringify(message))
}

function request<TResult = unknown>(method: string, params: JsonRecord): Promise<TResult> {
  const id = ++requestId
  send({ id, method, params })
  return new Promise<TResult>((resolveRequest, rejectRequest) => {
    pending.set(id, {
      resolveRequest: (value) => resolveRequest(value as TResult),
      rejectRequest,
    })
  })
}

const inputCommands = createInterface({ input: process.stdin })
async function handleInputCommand(line: string) {
  let command: unknown
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (!isRecord(command)) return
  if (command.type === 'steer') {
    const commandId = String(command.command_id || '')
    const steeringPrompt = String(command.prompt || '').trim()
    if (!commandId || !steeringPrompt || !threadId || !turnId || completed) {
      emit('steer_rejected', {
        command_id: commandId,
        message: 'The active Codex turn is no longer available to steer',
      })
      return
    }
    try {
      const response = await steerActiveTurn(turnId, (expectedTurnId) =>
        request<TurnSteerResponse>('turn/steer', {
          threadId: threadId!,
          expectedTurnId,
          input: codexTurnInput(steeringPrompt),
        }),
      )
      turnId = response.turnId
      emit('steer_accepted', {
        command_id: commandId,
        thread_id: threadId,
        turn_id: response.turnId,
      })
    } catch (error) {
      emit('steer_rejected', {
        command_id: commandId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }
  if (command.type !== 'user_input_response') return
  const inboundRequestId = inboundRequests.get(String(command.request_id))
  if (inboundRequestId === undefined) {
    emit('input_response_rejected', {
      request_id: command.request_id,
      reason: 'Question request is no longer pending',
    })
    return
  }
  const answers = isRecord(command.answers) ? command.answers : {}
  send({ id: inboundRequestId, result: { answers } })
  inboundRequests.delete(String(command.request_id))
  emit('input_answered', { request_id: inboundRequestId, question_ids: Object.keys(answers) })
}
inputCommands.on('line', (line) => {
  void handleInputCommand(line)
})

const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
  appServer.on('message', (data: RawData) => {
    let message: RpcMessage
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const pendingRequest = pending.get(message.id)
      pending.delete(message.id)
      if (!pendingRequest) return
      if (message.error) pendingRequest.rejectRequest(new Error(message.error.message || JSON.stringify(message.error)))
      else pendingRequest.resolveRequest(message.result)
      return
    }
    if (message.method === 'item/tool/requestUserInput' && message.id !== undefined) {
      if (message.params?.threadId === threadId && message.params.turnId) turnId = message.params.turnId
      inboundRequests.set(String(message.id), message.id)
      emit('input_required', {
        request_id: message.id,
        thread_id: message.params?.threadId,
        turn_id: message.params?.turnId,
        item_id: message.params?.itemId,
        questions: message.params?.questions || [],
        auto_resolution_ms: message.params?.autoResolutionMs ?? null,
      })
      return
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = message.params?.item
      if (message.method === 'item/completed' && item?.type === 'agentMessage') emit('agent_message', { text: item.text })
      const action = codexActionEvent(
        item,
        message.method === 'item/completed' ? 'completed' : 'started',
        message.params?.threadId || threadId,
      )
      if (action) emit(action.event, action)
    }
    if (message.method === 'turn/started' && message.params?.threadId === threadId && message.params.turn?.id) {
      turnId = message.params.turn.id
    }
    for (const context of settingsContextEvents(message, threadId)) emit('thread_context_updated', context)
    if (message.method === 'turn/diff/updated' && message.params?.threadId === threadId) {
      latestDiff = message.params.diff || ''
      if (diffTimer) clearTimeout(diffTimer)
      diffTimer = setTimeout(flushDiff, 750)
    }
    if (message.method === 'turn/completed' && message.params?.threadId === threadId) {
      const completedTurnId = message.params.turn?.id || null
      if (turnId === completedTurnId) turnId = null
      if (!completedMonitoredTurn(monitoredTurnId, completedTurnId)) return
      if (diffTimer) clearTimeout(diffTimer)
      flushDiff()
      completed = true
      const status = message.params.turn?.status
      emit('turn_completed', {
        thread_id: threadId,
        turn_id: completedTurnId || monitoredTurnId,
        status,
      })
      if (status === 'completed') resolveCompletion()
      else rejectCompletion(new Error(`Codex turn ended without completing the task (${status || 'unknown status'})`))
    }
  })
  appServer.on('error', rejectCompletion)
  appServer.on('close', (code) => {
    if (expectCompletion && !completed) rejectCompletion(new Error(`Codex control-server connection closed before completion (${code})`))
  })
})

async function main() {
  await connected
  await request('initialize', {
    clientInfo: { name: 'vertexade', title: 'VertexADE', version: '0.0.1' },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [
        'command/exec/outputDelta',
        'item/agentMessage/delta',
        'item/plan/delta',
        'item/fileChange/outputDelta',
        'item/reasoning/summaryTextDelta',
        'item/reasoning/textDelta',
      ],
    },
  })
  send({ method: 'initialized' })
  if (forkId) {
    const forked = await request<ThreadResponse>('thread/fork', {
      threadId: forkId,
      cwd,
      runtimeWorkspaceRoots: roots,
      threadSource: 'vertexade',
      ephemeral,
      excludeTurns: true,
      config: threadConfig,
    })
    threadId = forked.thread.id
    emit('thread_forked', {
      thread_id: threadId,
      source_thread_id: forkId,
      cwd,
      base,
      ...threadResponseDetails(forked),
    })
  } else if (resumeId) {
    const resumed = await request<ThreadResponse>('thread/resume', {
      threadId: resumeId,
      cwd,
      runtimeWorkspaceRoots: roots,
      excludeTurns: true,
      config: threadConfig,
    })
    emit('thread_roots_updated', {
      thread_id: resumeId,
      cwd,
      base,
      ...threadResponseDetails(resumed),
    })
    threadId = resumeId
  } else {
    const started = await request<ThreadResponse>('thread/start', threadParams)
    threadId = started.thread.id
    emit('thread_started', {
      thread_id: threadId,
      cwd,
      base,
      ...threadResponseDetails(started),
    })
  }
  if (!prompt) return
  const turn = await request<TurnResponse>('turn/start', {
    threadId,
    input: codexTurnInput(prompt),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(fullAccess
      ? {
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
        }
      : readOnly
        ? {
            approvalPolicy: 'never',
            sandboxPolicy: { type: 'readOnly', networkAccess: false },
          }
        : reviewMode
          ? {
              approvalPolicy: 'never',
              sandboxPolicy: {
                type: 'workspaceWrite',
                writableRoots: roots,
                networkAccess: true,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
            }
          : {}),
  })
  turnId = turn.turn.id
  monitoredTurnId = turn.turn.id
  emitRequestedThreadContext(threadId)
  expectCompletion = true
  await completion
}

process.on('SIGTERM', () => {
  inputCommands.close()
  appServer.close()
})

try {
  await main()
  inputCommands.close()
  appServer.close()
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  inputCommands.close()
  appServer.close()
  process.exitCode = 1
}
