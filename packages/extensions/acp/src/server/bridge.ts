import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import type { McpServer, RequestPermissionRequest, SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentMcpServer } from '@vertexade/platform-contracts'

type BridgeOptions = {
  command: string
  agentArgs: string[]
  cwd: string
  prompt: string
  resume: string
  fork: string
  permissionPolicy: 'approve' | 'deny'
  reviewMode: boolean
  allowSubagents: boolean
}

function emit(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`)
}

function executable(command: string) {
  if (isAbsolute(command)) return command
  for (const directory of String(process.env.PATH || '')
    .split(delimiter)
    .filter(Boolean)) {
    const candidate = join(directory, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  throw new Error(`Could not resolve MCP executable ${command} on PATH`)
}

export function acpMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) return []
  return (value as AgentMcpServer[]).map((server) =>
    server.transport === 'sse'
      ? {
          type: 'sse' as const,
          name: server.name,
          url: server.url,
          headers: Object.entries(server.headers || {}).map(([name, value]) => ({ name, value })),
        }
      : {
          name: server.name,
          command: executable(server.command),
          args: server.args || [],
          env: Object.entries(server.env || {}).map(([name, value]) => ({ name, value })),
        },
  )
}

function configuredMcpServers() {
  try {
    return acpMcpServers(JSON.parse(process.env.VERTEXADE_MCP_SERVERS || '[]'))
  } catch (error) {
    throw new Error(`Invalid ACP MCP configuration: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseArguments(argv: string[]): BridgeOptions {
  const values: Record<string, string[]> = Object.create(null)
  const flags = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--review-mode' || name === '--allow-subagents') {
      flags.add(name)
      continue
    }
    if (!name?.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid ACP bridge argument: ${name || '(empty)'}`)
    ;(values[name] ||= []).push(argv[index + 1]!)
    index += 1
  }
  const first = (name: string) => values[name]?.[0] || ''
  const command = first('--command')
  const cwd = first('--cwd')
  if (!command || !cwd) throw new Error('ACP bridge requires --command and --cwd')
  return {
    command,
    agentArgs: values['--agent-arg'] || [],
    cwd,
    prompt: first('--prompt'),
    resume: first('--resume'),
    fork: first('--fork'),
    permissionPolicy: first('--permission-policy') === 'deny' ? 'deny' : 'approve',
    reviewMode: flags.has('--review-mode'),
    allowSubagents: flags.has('--allow-subagents'),
  }
}

function rejection(options: RequestPermissionRequest['options']) {
  const option = options.find(({ kind }) => kind === 'reject_always') || options.find(({ kind }) => kind === 'reject_once')
  return option ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } } : { outcome: { outcome: 'cancelled' as const } }
}

export function permissionDecision(params: RequestPermissionRequest, options: Pick<BridgeOptions, 'permissionPolicy' | 'reviewMode'>) {
  const mutatingReviewTool = options.reviewMode && ['edit', 'delete', 'move'].includes(String(params.toolCall.kind || ''))
  if (options.permissionPolicy === 'deny' || mutatingReviewTool) return rejection(params.options)
  const option = params.options.find(({ kind }) => kind === 'allow_always') || params.options.find(({ kind }) => kind === 'allow_once')
  return option ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } } : rejection(params.options)
}

type UpdateRecord = Record<string, any>
type UpdateResult = { event: Record<string, unknown> | null; accumulatedText: string }
type UpdateHandler = (update: UpdateRecord, threadId: string, accumulatedText: string) => UpdateResult

function actionStatus(status: unknown) {
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'completed'
  return 'running'
}

function actionData(update: UpdateRecord, title: string) {
  const action: Record<string, unknown> = {
    id: update.toolCallId,
    title,
    kind: update.kind || 'tool',
    status: actionStatus(update.status),
  }
  if (update.rawInput !== undefined) action.input = update.rawInput
  if (update.rawOutput !== undefined) action.output = update.rawOutput
  return action
}

const messageUpdate: UpdateHandler = (update, threadId, accumulatedText) => {
  if (update.content?.type !== 'text') return { event: null, accumulatedText }
  const text = accumulatedText + update.content.text
  return {
    event: { event: 'agent_message', thread_id: threadId, text, streaming: true },
    accumulatedText: text,
  }
}

const toolStarted: UpdateHandler = (update, threadId, accumulatedText) => ({
  event: {
    event: 'action_started',
    thread_id: threadId,
    action: actionData(update, update.title || update.kind || 'Agent action'),
  },
  accumulatedText,
})

const toolUpdated: UpdateHandler = (update, threadId, accumulatedText) => {
  const completed = ['completed', 'failed'].includes(String(update.status || ''))
  return {
    event: {
      event: completed ? 'action_completed' : 'action_updated',
      thread_id: threadId,
      action: actionData(update, update.kind || 'Agent action'),
    },
    accumulatedText,
  }
}

const planUpdated: UpdateHandler = (update, threadId, accumulatedText) => ({
  event: { event: 'plan_updated', thread_id: threadId, plan: update },
  accumulatedText,
})

export function acpSessionContext(options: SessionConfigOption[] | null | undefined) {
  let model: string | null = null
  let reasoningEffort: string | null = null
  for (const option of options || []) {
    if (option.type !== 'select') continue
    const currentValue = String(option.currentValue || '').trim()
    if (!currentValue) continue
    const identity = `${option.id} ${option.name}`.toLowerCase()
    if (option.category === 'model') model = currentValue
    if (option.category === 'thought_level' || /reasoning|effort|thought/.test(identity)) reasoningEffort = currentValue
  }
  return { model, reasoning_effort: reasoningEffort }
}

const configOptionsUpdated: UpdateHandler = (update, threadId, accumulatedText) => {
  const context = acpSessionContext(update.configOptions)
  return {
    event: context.model || context.reasoning_effort ? { event: 'thread_context_updated', thread_id: threadId, ...context } : null,
    accumulatedText,
  }
}

const updateHandlers: Record<string, UpdateHandler> = {
  agent_message_chunk: messageUpdate,
  tool_call: toolStarted,
  tool_call_update: toolUpdated,
  plan: planUpdated,
  plan_update: planUpdated,
  config_option_update: configOptionsUpdated,
}

export function updateEvent(update: SessionUpdate, threadId: string, accumulatedText: string) {
  const handler = updateHandlers[update.sessionUpdate]
  return handler ? handler(update as UpdateRecord, threadId, accumulatedText) : { event: null, accumulatedText }
}

async function sessionIdFor(context: acp.ClientContext, initialized: acp.InitializeResponse, options: BridgeOptions) {
  const common = { cwd: options.cwd, mcpServers: configuredMcpServers() }
  if (options.fork) {
    if (!initialized.agentCapabilities?.sessionCapabilities?.fork) throw new Error('The configured ACP agent does not support session/fork')
    const forked = await context.request<
      { sessionId: string; configOptions?: SessionConfigOption[] | null },
      typeof common & { sessionId: string }
    >(acp.methods.agent.session.fork, { ...common, sessionId: options.fork })
    return forked
  }
  if (options.resume) {
    if (initialized.agentCapabilities?.sessionCapabilities?.resume) {
      const resumed = await context.request<{ configOptions?: SessionConfigOption[] | null }>(acp.methods.agent.session.resume, {
        ...common,
        sessionId: options.resume,
      })
      return { sessionId: options.resume, configOptions: resumed.configOptions }
    }
    if (initialized.agentCapabilities?.loadSession) {
      const loaded = await context.request<{ configOptions?: SessionConfigOption[] | null }>(acp.methods.agent.session.load, {
        ...common,
        sessionId: options.resume,
      })
      return { sessionId: options.resume, configOptions: loaded.configOptions }
    }
    throw new Error('The configured ACP agent does not support session/resume or legacy session/load')
  }
  return context.request<{ sessionId: string; configOptions?: SessionConfigOption[] | null }, typeof common>(
    acp.methods.agent.session.new,
    common,
  )
}

async function run(options: BridgeOptions) {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, options.agentArgs, {
    cwd: options.cwd,
    env: { ...process.env, VERTEXADE_ALLOW_SUBAGENTS: options.allowSubagents ? 'true' : 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  child.stderr.pipe(process.stderr)
  const terminate = () => child.kill('SIGTERM')
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)
  let threadId = options.resume || options.fork
  let accumulatedText = ''
  const application = acp
    .client({ name: 'vertexade-pr-management' })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => permissionDecision(params, options))
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const mapped = updateEvent(params.update, params.sessionId, accumulatedText)
      accumulatedText = mapped.accumulatedText
      if (mapped.event) emit(mapped.event)
    })
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  )
  try {
    await application.connectWith(stream, async (context) => {
      const initialized = await context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'VertexADE PR Management', version: '0.0.1' },
      })
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION)
        throw new Error(`ACP protocol mismatch: client v${acp.PROTOCOL_VERSION}, agent v${initialized.protocolVersion}`)
      const session = await sessionIdFor(context, initialized, options)
      threadId = session.sessionId
      emit({
        event: 'thread_started',
        thread_id: threadId,
        protocol_version: initialized.protocolVersion,
        agent: initialized.agentInfo || null,
        ...acpSessionContext(session.configOptions),
      })
      const result = await context.request(acp.methods.agent.session.prompt, {
        sessionId: threadId,
        prompt: [{ type: 'text', text: options.prompt }],
      })
      if (accumulatedText)
        emit({
          event: 'agent_message',
          thread_id: threadId,
          text: accumulatedText,
          streaming: true,
        })
      emit({
        event: 'turn_completed',
        thread_id: threadId,
        status: 'completed',
        reason: result.stopReason,
      })
    })
  } finally {
    process.removeListener('SIGINT', terminate)
    process.removeListener('SIGTERM', terminate)
    if (!child.killed) child.kill('SIGTERM')
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  run(parseArguments(process.argv.slice(2))).catch((error) => {
    emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
}
