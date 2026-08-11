export type SetupTool = {
  id: string
  name: string
  ready: boolean
  required: boolean
  detail: string
  install: string
}

export type SetupStatus = {
  ready: boolean
  runtime: { nodeVersion: string; production: boolean }
  tools: SetupTool[]
  scm: {
    id: string
    name: string
    ready: boolean
    source: string
    connected: boolean
    error: string
  }
  agents: { id: string; name: string; enabled: boolean; ready: boolean; tool: SetupTool | null }[]
  extensions: {
    ready: number
    total: number
    modules: { id: string; name: string; lifecycle: string; configured?: boolean }[]
  }
  operations: {
    deployment: { commitSha?: string; deployedAt?: string; status?: string } | null
    process: { pid: number; uptimeSeconds: number; residentMemoryBytes: number }
    queues: { queuedFollowUps: number; queuedReviews: number; oldestQueuedReview: string | null }
    activity: { activeJobs: number; failedAutomations: number }
    automations: {
      paused: boolean
      activeRuns: number
      pendingApprovals: number
      staleRuns: number
      oldestActiveAt: string | null
    }
  } | null
}

export type SetupMilestone = {
  id: 'application' | 'tools' | 'scm' | 'agent'
  label: string
  ready: boolean
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid setup status: ${label}`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid setup status: ${label}`)
  return value
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid setup status: ${label}`)
  return value
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid setup status: ${label}`)
  return value
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label)
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : text(value, label)
}

function setupTool(value: unknown, label: string): SetupTool {
  const input = record(value, label)
  return {
    id: text(input.id, `${label}.id`),
    name: text(input.name, `${label}.name`),
    ready: flag(input.ready, `${label}.ready`),
    required: flag(input.required, `${label}.required`),
    detail: text(input.detail, `${label}.detail`),
    install: text(input.install, `${label}.install`),
  }
}

function setupOperations(value: unknown): SetupStatus['operations'] {
  if (value === null) return null
  const input = record(value, 'operations')
  const deploymentInput = input.deployment === null ? null : record(input.deployment, 'operations.deployment')
  const process = record(input.process, 'operations.process')
  const queues = record(input.queues, 'operations.queues')
  const activity = record(input.activity, 'operations.activity')
  const automations = record(input.automations, 'operations.automations')
  return {
    deployment: deploymentInput
      ? {
          commitSha: optionalText(deploymentInput.commitSha, 'operations.deployment.commitSha'),
          deployedAt: optionalText(deploymentInput.deployedAt, 'operations.deployment.deployedAt'),
          status: optionalText(deploymentInput.status, 'operations.deployment.status'),
        }
      : null,
    process: {
      pid: number(process.pid, 'operations.process.pid'),
      uptimeSeconds: number(process.uptimeSeconds, 'operations.process.uptimeSeconds'),
      residentMemoryBytes: number(process.residentMemoryBytes, 'operations.process.residentMemoryBytes'),
    },
    queues: {
      queuedFollowUps: number(queues.queuedFollowUps, 'operations.queues.queuedFollowUps'),
      queuedReviews: number(queues.queuedReviews, 'operations.queues.queuedReviews'),
      oldestQueuedReview: nullableText(queues.oldestQueuedReview, 'operations.queues.oldestQueuedReview'),
    },
    activity: {
      activeJobs: number(activity.activeJobs, 'operations.activity.activeJobs'),
      failedAutomations: number(activity.failedAutomations, 'operations.activity.failedAutomations'),
    },
    automations: {
      paused: flag(automations.paused, 'operations.automations.paused'),
      activeRuns: number(automations.activeRuns, 'operations.automations.activeRuns'),
      pendingApprovals: number(automations.pendingApprovals, 'operations.automations.pendingApprovals'),
      staleRuns: number(automations.staleRuns, 'operations.automations.staleRuns'),
      oldestActiveAt: nullableText(automations.oldestActiveAt, 'operations.automations.oldestActiveAt'),
    },
  }
}

export function parseSetupStatus(value: unknown): SetupStatus {
  const input = record(value, 'response')
  const runtime = record(input.runtime, 'runtime')
  const scm = record(input.scm, 'scm')
  const extensions = record(input.extensions, 'extensions')
  if (!Array.isArray(input.tools) || !Array.isArray(input.agents) || !Array.isArray(extensions.modules)) {
    throw new Error('Invalid setup status: collections')
  }
  return {
    ready: flag(input.ready, 'ready'),
    runtime: {
      nodeVersion: text(runtime.nodeVersion, 'runtime.nodeVersion'),
      production: flag(runtime.production, 'runtime.production'),
    },
    tools: input.tools.map((tool, index) => setupTool(tool, `tools[${index}]`)),
    scm: {
      id: text(scm.id, 'scm.id'),
      name: text(scm.name, 'scm.name'),
      ready: flag(scm.ready, 'scm.ready'),
      source: text(scm.source, 'scm.source'),
      connected: flag(scm.connected, 'scm.connected'),
      error: text(scm.error, 'scm.error'),
    },
    agents: input.agents.map((value, index) => {
      const agent = record(value, `agents[${index}]`)
      return {
        id: text(agent.id, `agents[${index}].id`),
        name: text(agent.name, `agents[${index}].name`),
        enabled: flag(agent.enabled, `agents[${index}].enabled`),
        ready: flag(agent.ready, `agents[${index}].ready`),
        tool: agent.tool === null ? null : setupTool(agent.tool, `agents[${index}].tool`),
      }
    }),
    extensions: {
      ready: number(extensions.ready, 'extensions.ready'),
      total: number(extensions.total, 'extensions.total'),
      modules: extensions.modules.map((value, index) => {
        const module = record(value, `extensions.modules[${index}]`)
        return {
          id: text(module.id, `extensions.modules[${index}].id`),
          name: text(module.name, `extensions.modules[${index}].name`),
          lifecycle: text(module.lifecycle, `extensions.modules[${index}].lifecycle`),
          configured: module.configured === undefined ? undefined : flag(module.configured, `extensions.modules[${index}].configured`),
        }
      }),
    },
    operations: setupOperations(input.operations),
  }
}

export function setupMilestones(status: SetupStatus, applicationLabel = 'Application running'): SetupMilestone[] {
  return [
    { id: 'application', label: applicationLabel, ready: true },
    {
      id: 'tools',
      label: 'Core tools',
      ready: status.tools.filter((tool) => tool.required).every((tool) => tool.ready),
    },
    { id: 'scm', label: `${status.scm.name} connected`, ready: status.scm.ready },
    { id: 'agent', label: 'Execution agent', ready: status.agents.some((agent) => agent.ready) },
  ]
}
