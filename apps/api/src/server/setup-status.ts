import { Effect } from 'effect'
import { tryApiPromise } from '@vertexade/platform-server/effect'

type Runner = (command: string, args: string[], options?: { timeoutMs?: number; maxOutputBytes?: number }) => Promise<string>
export type ToolSpec = {
  id: string
  name: string
  command: string
  args: string[]
  required?: boolean
  install: string
}

const coreToolSpecs: ToolSpec[] = [
  {
    id: 'mise',
    name: 'mise',
    command: 'mise',
    args: ['--version'],
    install: 'Recommended: install mise, then run mise trust && mise install in the VertexADE checkout',
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    command: 'pnpm',
    args: ['--version'],
    required: true,
    install: 'Recommended: run mise trust && mise install; or install Node.js 22.13+ and enable pnpm manually',
  },
  {
    id: 'git',
    name: 'Git',
    command: 'git',
    args: ['--version'],
    required: true,
    install: 'Install Git from https://git-scm.com',
  },
  {
    id: 'pm2',
    name: 'PM2',
    command: 'pm2',
    args: ['--version'],
    install: 'Optional: install PM2 for persistent production processes',
  },
]

function firstLine(value: unknown) {
  return String(value || '')
    .trim()
    .split(/\r?\n/)[0]
    .slice(0, 240)
}

function inspectSetupTool(run: Runner, spec: ToolSpec) {
  return tryApiPromise(
    () =>
      run(spec.command, spec.args, {
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      }),
    {
      kind: 'unavailable',
      message: `${spec.name} is not available`,
      status: 503,
      code: 'SETUP_TOOL_UNAVAILABLE',
      causeMessage: 'replace',
    },
  ).pipe(
    Effect.match({
      onFailure: (failure) => ({
        id: spec.id,
        name: spec.name,
        ready: false,
        required: Boolean(spec.required),
        detail: firstLine(failure.message) || 'Not available',
        install: spec.install,
      }),
      onSuccess: (output) => ({
        id: spec.id,
        name: spec.name,
        ready: true,
        required: Boolean(spec.required),
        detail: firstLine(output) || 'Available',
        install: spec.install,
      }),
    }),
    Effect.withSpan(`setup.tool ${spec.id}`),
  )
}

export function inspectSetupToolsEffect(run: Runner, contributed: ToolSpec[] = []) {
  const specs = [...new Map([...coreToolSpecs, ...contributed].map((spec) => [spec.id, spec])).values()]
  return Effect.forEach(specs, (spec) => inspectSetupTool(run, spec), {
    concurrency: 'unbounded',
  }).pipe(Effect.withSpan('setup.inspect-tools'))
}

export function inspectSetupTools(run: Runner, contributed: ToolSpec[] = []) {
  return Effect.runPromise(inspectSetupToolsEffect(run, contributed))
}

export function createSetupStatus({
  tools,
  scm,
  agents,
  extensions,
  operations,
  nodeVersion = process.version,
  production = process.env.NODE_ENV === 'production',
}: {
  tools: Awaited<ReturnType<typeof inspectSetupTools>>
  scm: { id: string; name: string; authentication: Record<string, unknown> }
  agents: { id: string; name: string; enabled: boolean; setupCheckIds?: string[] }[]
  extensions: { id: string; name: string; lifecycle: string; enabled?: boolean; configured?: boolean }[]
  operations?: Record<string, unknown>
  nodeVersion?: string
  production?: boolean
}) {
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]))
  const source = String(scm.authentication.source || '')
  const requiredSetupCheckId = String(scm.authentication.requiredSetupCheckId || '')
  const authenticationToolReady = !requiredSetupCheckId || Boolean(byId[requiredSetupCheckId]?.ready)
  const scmReady = Boolean(scm.authentication.connected) && authenticationToolReady
  const agentStatus = agents.map((agent) => {
    const checks = (agent.setupCheckIds || []).map((id) => byId[id]).filter(Boolean)
    const tool = checks[0] || null
    return { ...agent, ready: agent.enabled && checks.every((check) => check.ready), tool, checks }
  })
  const requiredToolsReady = tools.filter((tool) => tool.required).every((tool) => tool.ready)
  const agentReady = agentStatus.some((agent) => agent.ready)
  const enabledExtensions = extensions.filter((extension) => extension.enabled !== false)
  const extensionReady = enabledExtensions.filter((extension) => extension.lifecycle === 'ready').length
  return {
    ready: requiredToolsReady && scmReady && agentReady,
    runtime: { nodeVersion, production },
    tools,
    scm: {
      id: scm.id,
      name: scm.name,
      ready: scmReady,
      source,
      connected: Boolean(scm.authentication.connected),
      error: String(scm.authentication.error || ''),
    },
    agents: agentStatus,
    extensions: { ready: extensionReady, total: enabledExtensions.length, modules: extensions },
    operations: operations || null,
  }
}
