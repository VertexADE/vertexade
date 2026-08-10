export type GitHubDeploymentTargetConfiguration = {
  id: string
  label: string
  enabled: boolean
  repository: string
  workflow: string
  branch: string
  event: string
  services: string[]
  environments: string[]
  productionEnvironment: string
  comparisonEnvironment: string
  jobNameTemplate: string
}

export type GitHubDeploymentJob = {
  service: string
  environment: string
}

const deploymentEvents = new Set(['push', 'workflow_dispatch', 'schedule', 'pull_request', 'release'])
const defaultJobNameTemplate = 'Build and deploy service - {service} / Deploy {*} -> {environment}'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown, label: string, maximum: number) {
  const candidate = String(value || '').trim()
  if (!candidate) throw new Error(`${label} is required`)
  if (candidate.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`)
  return candidate
}

function identifier(value: unknown, label: string) {
  const candidate = text(value, label, 48).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(candidate)) {
    throw new Error(`${label} must use letters, numbers, dots, dashes, or underscores`)
  }
  return candidate
}

function stringList(value: unknown, label: string, maximum: number, normalize: (item: unknown, label: string) => string) {
  const input = Array.isArray(value) ? value : []
  if (input.length > maximum) throw new Error(`${label} supports at most ${maximum} entries`)
  const items = input.map((item, index) => normalize(item, `${label} entry ${index + 1}`))
  if (new Set(items.map((item) => item.toLowerCase())).size !== items.length) throw new Error(`${label} contains duplicates`)
  return items
}

function repository(value: unknown) {
  const candidate = text(value, 'Deployment repository', 200)
  if (!/^[\w.-]+\/[\w.-]+$/.test(candidate)) throw new Error('Deployment repository must use owner/repository format')
  return candidate
}

function template(value: unknown) {
  const candidate = text(value || defaultJobNameTemplate, 'Deployment job name template', 500)
  const serviceTokens = candidate.match(/\{service\}/g)?.length || 0
  const environmentTokens = candidate.match(/\{environment\}/g)?.length || 0
  if (serviceTokens !== 1 || environmentTokens !== 1) {
    throw new Error('Deployment job name template must contain exactly one {service} and one {environment} placeholder')
  }
  compileDeploymentJobMatcher(candidate)
  return candidate
}

function environmentSelection(value: unknown, environments: string[], label: string, fallback: string) {
  const selected = identifier(value || fallback, label)
  if (!environments.includes(selected)) throw new Error(`${label} must match a configured environment`)
  return selected
}

function deploymentEvent(value: unknown, label: string) {
  const event = text(value || 'push', `${label} event`, 50)
  if (!deploymentEvents.has(event)) throw new Error(`${label} event is not supported`)
  return event
}

function normalizeTarget(candidate: unknown, index: number): GitHubDeploymentTargetConfiguration {
  const target = record(candidate)
  const label = `Deployment target ${index + 1}`
  const environments = stringList(target.environments, `${label} environments`, 20, identifier)
  if (!environments.length) throw new Error(`${label} requires at least one environment`)
  return {
    id: identifier(target.id || `target-${index + 1}`, `${label} id`),
    label: text(target.label || label, `${label} label`, 80),
    enabled: target.enabled !== false,
    repository: repository(target.repository),
    workflow: text(target.workflow, `${label} workflow`, 255),
    branch: text(target.branch || 'main', `${label} branch`, 255),
    event: deploymentEvent(target.event, label),
    services: stringList(target.services, `${label} services`, 200, (item, itemLabel) => text(item, itemLabel, 120)),
    environments,
    productionEnvironment: environmentSelection(
      target.production_environment ?? target.productionEnvironment,
      environments,
      `${label} production environment`,
      environments.at(-1)!,
    ),
    comparisonEnvironment: environmentSelection(
      target.comparison_environment ?? target.comparisonEnvironment,
      environments,
      `${label} comparison environment`,
      environments[0]!,
    ),
    jobNameTemplate: template(target.job_name_template ?? target.jobNameTemplate),
  }
}

export function defaultGitHubDeploymentTargets(environment: NodeJS.ProcessEnv = process.env): GitHubDeploymentTargetConfiguration[] {
  const environments = String(environment.DEPLOYMENT_ENVIRONMENTS || 'dev,acc,prd')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return [
    {
      id: 'default',
      label: 'Default deployment',
      enabled: true,
      repository: environment.DEPLOYMENT_REPOSITORY || 'vertexade/vertexade',
      workflow: environment.DEPLOYMENT_WORKFLOW || 'monorepo.yml',
      branch: environment.DEPLOYMENT_BRANCH || 'main',
      event: environment.DEPLOYMENT_EVENT || 'push',
      services: String(
        environment.DEPLOYMENT_SERVICES ||
          [
            'availability-service',
            'booking-service',
            'master-data-service',
            'site-access-service',
            'tridens-integration',
            'unified-api',
          ].join(','),
      )
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      environments,
      productionEnvironment: environment.DEPLOYMENT_PRODUCTION_ENVIRONMENT || environments.at(-1) || 'prd',
      comparisonEnvironment: environment.DEPLOYMENT_COMPARISON_ENVIRONMENT || environments[0] || 'dev',
      jobNameTemplate: environment.DEPLOYMENT_JOB_NAME_TEMPLATE || defaultJobNameTemplate,
    },
  ]
}

export function normalizeGitHubDeploymentTargets(
  value: unknown,
  fallback: GitHubDeploymentTargetConfiguration[] = defaultGitHubDeploymentTargets(),
): GitHubDeploymentTargetConfiguration[] {
  const input = value === undefined ? fallback : value
  if (!Array.isArray(input)) throw new Error('Deployment targets must be a list')
  if (input.length > 20) throw new Error('At most 20 deployment targets may be configured')
  const targets = input.map(normalizeTarget)
  if (new Set(targets.map((target) => target.id)).size !== targets.length) throw new Error('Deployment target ids must be unique')
  return targets
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function compileDeploymentJobMatcher(value: string) {
  const parts = value.split(/(\{service\}|\{environment\}|\{\*\})/g)
  const pattern = parts
    .map((part) => {
      if (part === '{service}') return '(?<service>[^/\\n]+?)'
      if (part === '{environment}') return '(?<environment>[^/\\n]+?)'
      if (part === '{*}') return '.+?'
      return escaped(part).replace(/\s+/g, '\\s+')
    })
    .join('')
  return new RegExp(`^${pattern}(?:\\s*\\/.*)?$`, 'i')
}

export function matchDeploymentJob(
  name: string,
  target: GitHubDeploymentTargetConfiguration,
  matcher: RegExp = compileDeploymentJobMatcher(target.jobNameTemplate),
): GitHubDeploymentJob | null {
  const match = matcher.exec(name)
  const service = match?.groups?.service?.trim()
  const environment = match?.groups?.environment?.trim().toLowerCase()
  if (!service || !environment || !target.environments.includes(environment)) return null
  return { service, environment }
}

export function publicDeploymentTargetConfiguration(target: GitHubDeploymentTargetConfiguration) {
  return {
    id: target.id,
    label: target.label,
    enabled: target.enabled,
    repository: target.repository,
    workflow: target.workflow,
    branch: target.branch,
    event: target.event,
    services: target.services,
    environments: target.environments,
    production_environment: target.productionEnvironment,
    comparison_environment: target.comparisonEnvironment,
    job_name_template: target.jobNameTemplate,
  }
}
