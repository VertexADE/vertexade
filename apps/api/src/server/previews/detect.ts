import { access, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findComposeFiles, findDockerfiles, findMatchingFiles } from './detect-files.ts'
import {
  composeNames,
  ignoredDirectories,
  toolFiles,
  validServiceName,
  type PreviewPlan,
  type PreviewPort,
  type PreviewRun,
  type PreviewServicePlan,
  type PreviewTool,
} from './detect-model.ts'

export type { PreviewPlan, PreviewPort, PreviewRun, PreviewServicePlan, PreviewTool } from './detect-model.ts'

function safeName(value: string, fallback = 'service') {
  return (
    value
      .toLowerCase()
      .replace(validServiceName, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  )
}

function inside(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate))
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..')
}

function uniquePorts(values: PreviewPort[]) {
  return [...new Map(values.map((port) => [`${port.containerPort}/${port.protocol}`, port])).values()].sort(
    (left, right) => left.containerPort - right.containerPort,
  )
}

function checkedPort(value: unknown) {
  const port = Number(String(value || '').match(/^\d+/)?.[0])
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
}

function composePorts(service: Record<string, any>): PreviewPort[] {
  const ports = (Array.isArray(service.ports) ? service.ports : []).flatMap((entry: any) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const target = checkedPort(String(entry).split(':').at(-1))
      return target ? [{ containerPort: target, protocol: 'tcp' as const }] : []
    }
    const target = checkedPort(entry?.target)
    const protocol = entry?.protocol === 'udp' ? ('udp' as const) : ('tcp' as const)
    return target ? [{ containerPort: target, protocol }] : []
  })
  for (const exposed of Array.isArray(service.expose) ? service.expose : []) {
    const target = checkedPort(exposed)
    if (target) ports.push({ containerPort: target, protocol: 'tcp' })
  }
  const environment = service.environment || {}
  const environmentPort = checkedPort(
    Array.isArray(environment) ? environment.find((entry: string) => entry.startsWith('PORT='))?.slice(5) : environment.PORT,
  )
  if (environmentPort) ports.push({ containerPort: environmentPort, protocol: 'tcp' })
  return uniquePorts(ports)
}

function composeBuild(value: unknown) {
  if (typeof value === 'string') return { context: value }
  return recordValue(value)
}

function recordValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined
}

function composeBuildContext(root: string, name: string, build: Record<string, any> | undefined) {
  if (!build?.context) return undefined
  const context = resolve(root, build.context)
  if (!inside(root, context)) throw new Error(`Compose service ${name} builds outside the worktree`)
  return context
}

function composeDockerfile(root: string, name: string, build: Record<string, any> | undefined, context: string | undefined) {
  if (!build) return undefined
  const dockerfile = build.dockerfile ? resolve(context || root, build.dockerfile) : context ? join(context, 'Dockerfile') : undefined
  if (dockerfile && !inside(root, dockerfile)) throw new Error(`Compose service ${name} uses a Dockerfile outside the worktree`)
  return dockerfile
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

async function optionalFile(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function existingFile(path: string) {
  try {
    await access(path)
    return path
  } catch {
    return null
  }
}

function packageManagerVersion(content: string | null, id: string) {
  if (!content) return undefined
  try {
    const value = JSON.parse(content).packageManager
    const match = typeof value === 'string' ? value.match(new RegExp(`^${id}@(.+)$`, 'i')) : null
    return match?.[1]
  } catch {
    return undefined
  }
}

function miseToolVersion(content: string | null, key: string) {
  if (!content) return undefined
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.match(new RegExp(`^[ \\t]*(?:"${escaped}"|'${escaped}'|${escaped})[ \\t]*=[ \\t]*["']([^"']+)["']`, 'm'))?.[1]
}

function miseConfiguredTools(content: string | null, sourceFile: string) {
  if (!content) return []
  const names: Record<string, string> = {
    node: 'Node.js',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    bun: 'Bun',
    deno: 'Deno',
    pnpm: 'pnpm',
    yarn: 'Yarn',
  }
  let toolsSection = false
  return content.split(/\r?\n/).flatMap((line) => {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1]
    if (section) {
      toolsSection = section === 'tools'
      return []
    }
    if (!toolsSection) return []
    const match = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s=]+))\s*=\s*["']([^"']+)["']/)
    const configured = match?.[1] || match?.[2] || match?.[3]
    if (!configured || !match?.[4]) return []
    const packageName = configured.startsWith('npm:') ? configured.slice(4) : configured
    if (packageName === '@moonrepo/cli') return []
    const id = packageName.startsWith('@') ? packageName.split('/').at(-1)! : packageName
    return [{ id, name: names[id] || packageName, sourceFile, version: match[4] }]
  })
}

async function detectPreviewTools(rootValue: string): Promise<PreviewTool[]> {
  const root = resolve(rootValue)
  const packageJson = await optionalFile(join(root, 'package.json'))
  const miseMatches = await Promise.all(
    ['mise.toml', '.mise.toml'].map(async (file) => ((await existingFile(join(root, file))) ? file : null)),
  )
  const misePath = miseMatches.find(Boolean)
  const miseContent = await optionalFile(join(root, misePath || 'mise.toml'))
  const moonFile = ['workspace.yml', 'workspace.yaml'].map((file) => join(root, '.moon', file))
  const moonSource = (await Promise.all(moonFile.map(existingFile))).find(Boolean)
  const tools: PreviewTool[] = []
  if (moonSource)
    tools.push({
      id: 'moon',
      name: 'Moon',
      sourceFile: moonSource,
      version: miseToolVersion(miseContent, 'npm:@moonrepo/cli'),
    })
  if (misePath) {
    const sourceFile = join(root, misePath)
    tools.push({ id: 'mise', name: 'mise', sourceFile }, ...miseConfiguredTools(miseContent, sourceFile))
  }
  for (const definition of toolFiles) {
    if (definition.id === 'mise') continue
    const matches = await Promise.all(definition.files.map(async (file) => ((await existingFile(join(root, file))) ? file : null)))
    const source = matches.find(Boolean)
    if (!source) continue
    const version = ['pnpm', 'npm', 'yarn', 'bun'].includes(definition.id) ? packageManagerVersion(packageJson, definition.id) : undefined
    const existing = tools.find((tool) => tool.id === definition.id)
    if (existing) {
      if (version) existing.version = version
      continue
    }
    tools.push({
      id: definition.id,
      name: definition.name,
      sourceFile: join(root, source),
      version,
    })
  }
  return tools
}

function yamlRecord(content: string | null) {
  if (!content) return undefined
  try {
    return recordValue(parseYaml(content))
  } catch {
    return undefined
  }
}

function moonProjects(config: Record<string, any>) {
  const configured = recordValue(config.projects?.sources) || recordValue(config.projects)
  if (!configured) return []
  return Object.entries(configured).flatMap(([project, path]) => (typeof path === 'string' ? [{ project, path }] : []))
}

function moonDependencies(config: Record<string, any>) {
  return (Array.isArray(config.dependsOn) ? config.dependsOn : []).flatMap((dependency) => {
    if (typeof dependency === 'string') return [dependency]
    const id = optionalString(dependency?.id)
    return id ? [id] : []
  })
}

function composeFileFromMoonTask(projectRoot: string, config: Record<string, any>) {
  const tasks = recordValue(config.tasks) || {}
  for (const task of Object.values(tasks)) {
    const command = typeof task?.command === 'string' ? task.command : Array.isArray(task?.command) ? task.command.join(' ') : ''
    if (!/docker\s+compose\b/.test(command)) continue
    const explicit = command
      .match(/(?:^|\s)(?:-f|--file)(?:=|\s+)(?:['"]([^'"]+)['"]|([^\s]+))/)
      ?.slice(1)
      .find(Boolean)
    if (explicit) return resolve(projectRoot, explicit)
  }
  return composeNames.map((name) => join(projectRoot, name))
}

function envFile(content: string) {
  const environment: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:)\s*(.*?)\s*$/)
    if (!match || match[2].startsWith('#')) continue
    let value = match[2].replace(/\s+#.*$/, '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    environment[match[1]] = value
  }
  return environment
}

function mockFriendlyEnvironment(environment: Record<string, string>) {
  return Object.entries(environment).some(([key, value]) => /(?:^|_)MODE$/.test(key) && value.toLowerCase() === 'mock')
}

async function trackedFiles(root: string, run: PreviewRun) {
  try {
    const output = await run('git', ['ls-files', '-z'], { cwd: root, timeoutMs: 15_000 })
    return new Set(output.split('\0').filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

async function projectEnvironment(root: string, projectRoot: string, tracked: Set<string>) {
  for (const name of ['.env.preview', '.env.local', '.env']) {
    const file = join(projectRoot, name)
    const relativeFile = relative(root, file).split(sep).join('/')
    const content = await optionalFile(file)
    if (content !== null && (name === '.env.preview' || tracked.has(relativeFile))) {
      return { environment: envFile(content), source: file, example: false }
    }
  }
  const example = join(projectRoot, '.env.example')
  const content = await optionalFile(example)
  if (content !== null) return { environment: envFile(content), source: example, example: true }
  return null
}

function composePortMappings(service: Record<string, any>) {
  return (Array.isArray(service.ports) ? service.ports : []).flatMap((entry: any) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const values = String(entry).split(':')
      const target = checkedPort(values.at(-1))
      const published = values.length > 1 ? checkedPort(values.at(-2)) : target
      return target && published ? [{ published, target }] : []
    }
    const published = checkedPort(entry?.published)
    const target = checkedPort(entry?.target)
    return published && target ? [{ published, target }] : []
  })
}

function likelyHttpService(name: string, service: Record<string, any>, port: PreviewPort) {
  if (port.protocol !== 'tcp') return false
  if ([80, 443, 3000, 3001, 4000, 4173, 4200, 5000, 5173, 8000, 8080, 8081, 8888].includes(port.containerPort)) return true
  if (/(?:admin|frontend|portal|ui|web)/i.test(name)) return true
  return /https?:\/\//i.test(JSON.stringify(service.healthcheck || {}))
}

type PortService = { name: string; target: number }

function serviceForEnvironmentKey(key: string, serviceCatalog: Map<string, PortService>) {
  const keyTokens = key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !['api', 'base', 'connection', 'fqn', 'host', 'hostname', 'port', 'string', 'url'].includes(token))
  const services = [...serviceCatalog.values()]
  const matching = services.filter((service) => {
    const nameTokens = service.name
      .replace(/emulator/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    return (
      keyTokens.length > 0 &&
      keyTokens.every((token) =>
        token.length <= 2 ? nameTokens.includes(token) : nameTokens.some((nameToken) => nameToken.includes(token)),
      )
    )
  })
  if (matching.length === 1) return matching[0]
  if (keyTokens.length === 1 && keyTokens[0] === 'db') {
    const databases = services.filter((service) => [1433, 3306, 5432, 6379, 27017].includes(service.target))
    if (databases.length === 1) return databases[0]
  }
  return undefined
}

function rewriteLocalReferences(
  environment: Record<string, string>,
  portServices: Map<number, PortService>,
  serviceCatalog: Map<string, PortService>,
  publicUrls = false,
) {
  const rewritten = { ...environment }
  for (const [key, value] of Object.entries(rewritten)) {
    let next = value
    if (publicUrls)
      next = next.replace(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/g, (match, rawPort) => {
        const service = portServices.get(Number(rawPort))
        return service ? `vertexade-preview://${service.name}/${service.target}` : match
      })
    rewritten[key] = next.replace(/\b(?:localhost|127\.0\.0\.1):(\d+)\b/g, (match, rawPort) => {
      const service = portServices.get(Number(rawPort))
      return service ? `${service.name}:${service.target}` : match
    })
  }
  for (const [key, value] of Object.entries(rewritten)) {
    const hostKey = key.match(/^(.*)_(?:HOST(?:NAME)?|FQN)$/)
    if (!hostKey || !/^(?:localhost|127\.0\.0\.1)$/.test(value)) continue
    const port = checkedPort(rewritten[`${hostKey[1]}_PORT`])
    const service = (port ? portServices.get(port) : undefined) || serviceForEnvironmentKey(key, serviceCatalog)
    if (service) rewritten[key] = service.name
  }
  for (const [key, value] of Object.entries(rewritten)) {
    if (!/(?:localhost|127\.0\.0\.1)/.test(value)) continue
    const service = serviceForEnvironmentKey(key, serviceCatalog)
    if (service) rewritten[key] = value.replace(/(\w+:\/\/)(?:localhost|127\.0\.0\.1)\b/g, `$1${service.name}`)
  }
  return rewritten
}

function registerPortService(portServices: Map<number, PortService>, conflicts: Set<number>, port: number, service: PortService) {
  if (conflicts.has(port)) return
  const existing = portServices.get(port)
  if (!existing || existing.name === service.name) portServices.set(port, service)
  else {
    portServices.delete(port)
    conflicts.add(port)
  }
}

function namespacedVolume(project: string, name: string) {
  return safeName(`${project}-${name}`)
}

function rewriteToolService(service: Record<string, any>, serviceNames: Map<string, string>, volumes: Map<string, string>) {
  const next = structuredClone(service)
  if (recordValue(next.depends_on)) {
    next.depends_on = Object.fromEntries(Object.entries(next.depends_on).map(([name, value]) => [serviceNames.get(name) || name, value]))
  } else if (Array.isArray(next.depends_on)) {
    next.depends_on = next.depends_on.map((name: string) => serviceNames.get(name) || name)
  }
  next.volumes = (Array.isArray(next.volumes) ? next.volumes : []).map((volume: any) => {
    if (recordValue(volume) && volume.type === 'volume' && volumes.has(String(volume.source)))
      return { ...volume, source: volumes.get(String(volume.source)) }
    return volume
  })
  delete next.network_mode
  next.networks = ['default']
  return next
}

type MoonProject = {
  id: string
  root: string
  config: Record<string, any>
}

async function complexMoonPlan(root: string, moon: PreviewTool, run: PreviewRun): Promise<PreviewPlan | null> {
  const workspace = yamlRecord(await optionalFile(moon.sourceFile))
  if (!workspace) return null
  const projects: MoonProject[] = []
  for (const entry of moonProjects(workspace)) {
    const projectRoot = resolve(root, entry.path)
    if (!inside(root, projectRoot)) continue
    const configFile = (await Promise.all(['moon.yml', 'moon.yaml'].map((name) => existingFile(join(projectRoot, name))))).find(Boolean)
    const config = yamlRecord(configFile ? await optionalFile(configFile) : null)
    if (config) projects.push({ id: entry.project, root: projectRoot, config })
  }
  const toolProjects = projects.filter((project) => project.config.layer === 'tool')
  const applicationProjects = projects.filter((project) => project.config.layer === 'application')
  if (!toolProjects.length || !applicationProjects.length) return null

  const toolPlans: Array<{ project: MoonProject; plan: PreviewPlan }> = []
  for (const project of toolProjects) {
    const candidates = composeFileFromMoonTask(project.root, project.config)
    for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
      if (!(await existingFile(candidate))) continue
      try {
        toolPlans.push({ project, plan: await composePlan(root, candidate, run) })
        break
      } catch {}
    }
  }
  if (!toolPlans.length) return null

  const compose: Record<string, any> = { services: {}, networks: { default: {} }, volumes: {} }
  const services: PreviewServicePlan[] = []
  const warnings: string[] = []
  const toolServices = new Map<string, string[]>()
  const portServices = new Map<number, PortService>()
  const serviceCatalog = new Map<string, PortService>()
  const conflictingPorts = new Set<number>()
  const nameCounts = new Map<string, number>()
  for (const { plan } of toolPlans) {
    for (const name of Object.keys(plan.compose?.services || {})) nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
  }
  for (const { project, plan } of toolPlans) {
    const projectName = safeName(project.id.split('/').at(-1) || project.id)
    const originalServices = recordValue(plan.compose?.services) || {}
    const serviceNames = new Map(
      Object.keys(originalServices).map((name) => [name, nameCounts.get(name)! > 1 ? safeName(`${projectName}-${name}`) : name]),
    )
    const originalVolumes = recordValue(plan.compose?.volumes) || {}
    const volumeNames = new Map(Object.keys(originalVolumes).map((name) => [name, namespacedVolume(projectName, name)]))
    for (const [name, value] of Object.entries(originalVolumes)) compose.volumes[volumeNames.get(name)!] = value
    const owned: string[] = []
    for (const [originalName, raw] of Object.entries<Record<string, any>>(originalServices)) {
      const name = serviceNames.get(originalName)!
      const next = rewriteToolService(raw, serviceNames, volumeNames)
      compose.services[name] = next
      const service = composeServicePlan(root, name, next)
      service.ports = service.ports.map((port) => ({
        ...port,
        public: likelyHttpService(name, next, port),
      }))
      services.push(service)
      owned.push(name)
      for (const mapping of composePortMappings(raw))
        registerPortService(portServices, conflictingPorts, mapping.published, {
          name,
          target: mapping.target,
        })
      for (const port of service.ports) {
        registerPortService(portServices, conflictingPorts, port.containerPort, {
          name,
          target: port.containerPort,
        })
        if (!serviceCatalog.has(name)) serviceCatalog.set(name, { name, target: port.containerPort })
      }
    }
    toolServices.set(project.id, owned)
    warnings.push(...plan.warnings)
  }

  const tracked = await trackedFiles(root, run)
  const applications: Array<{
    project: MoonProject
    dockerfile: string
    planned: PreviewServicePlan
    configured: Awaited<ReturnType<typeof projectEnvironment>>
  }> = []
  for (const project of applicationProjects) {
    const dockerfile = join(project.root, 'Dockerfile')
    if (!(await existingFile(dockerfile))) continue
    const configured = await projectEnvironment(root, project.root, tracked)
    if (configured?.example && !mockFriendlyEnvironment(configured.environment)) {
      warnings.push(`${project.id} was skipped because it only has an example environment without a detected mock mode`)
      continue
    }
    const name = safeName(project.id)
    const planned = await dockerfileService(root, dockerfile, name)
    if (!planned.ports.length) {
      warnings.push(`${project.id} was skipped because its Dockerfile does not expose a preview port`)
      continue
    }
    applications.push({ project, dockerfile, planned, configured })
    const declaredPort = checkedPort(configured?.environment.PORT)
    const target = planned.ports.find((port) => port.protocol === 'tcp')?.containerPort
    if (target) serviceCatalog.set(name, { name, target })
    if (declaredPort && target) registerPortService(portServices, conflictingPorts, declaredPort, { name, target })
  }
  for (const { project, dockerfile, planned, configured } of applications) {
    const name = planned.name
    const dependencies = moonDependencies(project.config).flatMap((id) => toolServices.get(id) || [])
    const dependsOn = Object.fromEntries(
      dependencies.map((dependency) => [
        dependency,
        {
          condition: compose.services[dependency]?.healthcheck ? 'service_healthy' : 'service_started',
        },
      ]),
    )
    const environment = rewriteLocalReferences(
      configured?.environment || {},
      portServices,
      serviceCatalog,
      project.config.stack === 'frontend',
    )
    environment.HOST = '0.0.0.0'
    environment.HOSTNAME = '0.0.0.0'
    compose.services[name] = {
      build: { context: project.root, dockerfile, additional_contexts: { workspace: root } },
      environment,
      ...(dependencies.length ? { depends_on: dependsOn } : {}),
      networks: ['default'],
    }
    services.push({ ...planned, runtimeName: name, project: project.id })
    if (!configured) warnings.push(`${project.id} has no tracked preview environment; container defaults will be used`)
  }
  const plannedApplications = services.filter((service) => service.source === 'dockerfile')
  if (!plannedApplications.length) return null
  if (!Object.keys(compose.volumes).length) delete compose.volumes
  return {
    source: 'moon-compose',
    sourceFile: moon.sourceFile,
    services,
    tools: [],
    compose,
    warnings: [...new Set(warnings)],
  }
}

function moonTask(config: Record<string, any>) {
  const tasks = recordValue(config.tasks) || {}
  const explicit = optionalString(config.docker?.file?.startTask)
  if (explicit) return explicit
  return ['preview', 'dev', 'start', 'serve'].find((name) => recordValue(tasks[name]))
}

function moonTaskPort(task: Record<string, any> | undefined) {
  const environmentPort = checkedPort(task?.env?.PORT ?? task?.options?.env?.PORT)
  if (environmentPort) return environmentPort
  const command = typeof task?.command === 'string' ? task.command : Array.isArray(task?.command) ? task.command.join(' ') : ''
  return checkedPort(command.match(/(?:--port(?:=|\s+)|\bPORT=)(\d+)/i)?.[1])
}

async function moonPlan(root: string, moon: PreviewTool): Promise<PreviewPlan | null> {
  const workspace = yamlRecord(await optionalFile(moon.sourceFile))
  if (!workspace) return null
  const services: PreviewServicePlan[] = []
  const defaulted: string[] = []
  const configured = new Map(moonProjects(workspace).map((entry) => [resolve(root, entry.path), entry.project]))
  const configFiles = await findMatchingFiles(root, (name) => /^moon\.ya?ml$/i.test(name), ignoredDirectories, 5)
  for (const configFile of configFiles) {
    const projectRoot = dirname(configFile)
    if (!inside(root, projectRoot)) continue
    const config = yamlRecord(await optionalFile(configFile))
    if (!config) continue
    const project = configured.get(projectRoot) || optionalString(config.project?.name)
    if (!project) continue
    const task = moonTask(config)
    if (!task) continue
    const detectedPort = moonTaskPort(recordValue(config.tasks?.[task]))
    const port = detectedPort || 3000
    if (!detectedPort) defaulted.push(project)
    services.push({
      name: safeName(project),
      runtimeName: project,
      source: 'moon',
      context: projectRoot,
      project,
      task,
      ports: [{ containerPort: port, protocol: 'tcp' }],
    })
  }
  if (!services.length) return null
  return {
    source: 'moon',
    sourceFile: moon.sourceFile,
    services,
    tools: [],
    warnings: defaulted.map((project) => `${project} does not declare a preview port; container port 3000 is assumed`),
  }
}

function composeServicePlan(root: string, name: string, service: Record<string, any>): PreviewServicePlan {
  const build = composeBuild(service.build)
  const context = composeBuildContext(root, name, build)
  return {
    name: safeName(name),
    runtimeName: name,
    source: 'compose',
    ports: composePorts(service),
    context,
    dockerfile: composeDockerfile(root, name, build, context),
    image: optionalString(service.image),
  }
}

function parseCompose(output: string, root: string, sourceFile: string): PreviewPlan {
  const compose = JSON.parse(output)
  const services = Object.entries<Record<string, any>>(compose.services || {}).map(([name, service]) =>
    composeServicePlan(root, name, service),
  )
  return {
    source: 'compose',
    sourceFile,
    services,
    tools: [],
    compose,
    warnings: services.flatMap((service) =>
      service.ports.length ? [] : [`${service.name} has no detected HTTP port and will run without a preview URL`],
    ),
  }
}

async function composePlan(root: string, file: string, run: PreviewRun) {
  const projectDirectory = dirname(file)
  const output = await run(
    'docker',
    ['compose', '--project-directory', projectDirectory, '--profile', '*', '-f', file, 'config', '--format', 'json'],
    { cwd: projectDirectory, timeoutMs: 60_000 },
  )
  const plan = parseCompose(output, root, file)
  for (const service of plan.services) {
    if (service.ports.length || !service.dockerfile) continue
    try {
      service.ports = (await dockerfileService(root, service.dockerfile)).ports
    } catch {}
  }
  plan.warnings = plan.services.flatMap((service) =>
    service.ports.length ? [] : [`${service.name} has no detected HTTP port and will run without a preview URL`],
  )
  return plan
}

function quotedArguments(content: string, functionName: string) {
  const values: string[][] = []
  const pattern = new RegExp(`${functionName}\\s*\\(([^)]*)\\)`, 'g')
  for (const match of content.matchAll(pattern)) {
    values.push([...match[1].matchAll(/(['"])(.*?)\1/g)].map((entry) => entry[2]))
  }
  return values
}

function tiltComposeFiles(content: string, root: string) {
  return quotedArguments(content, 'docker_compose')
    .flatMap((arguments_) => arguments_)
    .map((value) => resolve(root, value))
    .filter((value) => inside(root, value))
}

function exposedPorts(line: string): PreviewPort[] {
  const value = line.match(/^\s*EXPOSE\s+(.+)$/i)?.[1]
  if (!value) return []
  return value.split(/\s+/).flatMap((token) => {
    const containerPort = checkedPort(token)
    return containerPort
      ? [
          {
            containerPort,
            protocol: token.toLowerCase().endsWith('/udp') ? ('udp' as const) : ('tcp' as const),
          },
        ]
      : []
  })
}

function environmentPort(line: string): PreviewPort[] {
  const containerPort = checkedPort(line.match(/^\s*(?:ENV|ARG)\s+PORT(?:=|\s+)(\d+)/i)?.[1])
  return containerPort ? [{ containerPort, protocol: 'tcp' }] : []
}

function dockerfilePorts(content: string): PreviewPort[] {
  return uniquePorts(content.split(/\r?\n/).flatMap((line) => [...exposedPorts(line), ...environmentPort(line)]))
}

async function dockerfileService(root: string, dockerfile: string, name?: string, image?: string): Promise<PreviewServicePlan> {
  const content = await readFile(dockerfile, 'utf8')
  const fileName = basename(dockerfile)
  const directoryName = relative(root, dirname(dockerfile)).split(sep).filter(Boolean).join('-')
  const fileSuffix = fileName.replace(/^Dockerfile[._-]?/i, '')
  const suffix = fileName === 'Dockerfile' ? directoryName || 'app' : [directoryName, fileSuffix].filter(Boolean).join('-')
  return {
    name: safeName(name || suffix, 'app'),
    runtimeName: safeName(name || suffix, 'app'),
    source: 'dockerfile',
    ports: dockerfilePorts(content),
    context: dirname(dockerfile),
    dockerfile,
    image,
  }
}

async function tiltDockerfilePlan(root: string, tiltFile: string, content: string) {
  const services: PreviewServicePlan[] = []
  for (const arguments_ of quotedArguments(content, 'docker_build')) {
    if (arguments_.length < 2) continue
    const [image, contextValue] = arguments_
    const context = resolve(root, contextValue)
    if (!inside(root, context)) continue
    const dockerfile = resolve(context, arguments_.find((value) => /^Dockerfile(?:[._-]|$)/i.test(basename(value))) || 'Dockerfile')
    if (!inside(root, dockerfile)) continue
    try {
      services.push(await dockerfileService(root, dockerfile, image.split('/').at(-1), image))
    } catch {}
  }
  if (!services.length) return null
  return {
    source: 'tilt-dockerfile' as const,
    sourceFile: tiltFile,
    services,
    tools: [],
    warnings: services.flatMap((service) =>
      service.ports.length ? [] : [`${service.name} has no detected port and cannot expose a preview URL`],
    ),
  }
}

async function detectTiltPlan(root: string, names: Set<string>, run: PreviewRun) {
  const tiltName = names.has('Tiltfile') ? 'Tiltfile' : names.has('tiltfile') ? 'tiltfile' : null
  if (!tiltName) return null
  const tiltFile = join(root, tiltName)
  const content = await readFile(tiltFile, 'utf8')
  for (const file of tiltComposeFiles(content, root)) {
    try {
      return {
        ...(await composePlan(root, file, run)),
        source: 'tilt-compose' as const,
        sourceFile: tiltFile,
      }
    } catch {}
  }
  return tiltDockerfilePlan(root, tiltFile, content)
}

async function detectRootComposePlan(root: string, names: Set<string>, run: PreviewRun) {
  const standard = composeNames.find((name) => names.has(name))
  return standard ? composePlan(root, join(root, standard), run) : null
}

async function detectNestedComposePlan(root: string, run: PreviewRun) {
  const files = (await findComposeFiles(root)).sort(
    (left, right) => left.split(sep).length - right.split(sep).length || left.localeCompare(right),
  )
  return files.length ? composePlan(root, files[0], run) : null
}

export async function detectWorktreePreview(rootValue: string, run: PreviewRun): Promise<PreviewPlan> {
  const root = resolve(rootValue)
  const tools = await detectPreviewTools(root)
  const entries = await readdir(root, { withFileTypes: true })
  const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const tiltPlan = await detectTiltPlan(root, names, run)
  if (tiltPlan) return { ...tiltPlan, tools }
  const rootComposePlan = await detectRootComposePlan(root, names, run)
  if (rootComposePlan) return { ...rootComposePlan, tools }
  const moon = tools.find((tool) => tool.id === 'moon')
  const detectedComplexMoonPlan = moon ? await complexMoonPlan(root, moon, run) : null
  if (detectedComplexMoonPlan) return { ...detectedComplexMoonPlan, tools }
  const nestedComposePlan = await detectNestedComposePlan(root, run)
  if (nestedComposePlan) return { ...nestedComposePlan, tools }
  const dockerfiles = await findDockerfiles(root)
  const services = await Promise.all(dockerfiles.map((file) => dockerfileService(root, file)))
  if (!services.length) {
    const detectedMoonPlan = moon ? await moonPlan(root, moon) : null
    if (detectedMoonPlan) return { ...detectedMoonPlan, tools }
    throw new Error('No Tiltfile, Compose file, Dockerfile, or runnable Moon preview task was detected in this worktree')
  }
  return {
    source: 'dockerfile',
    sourceFile: dockerfiles[0],
    services,
    tools,
    warnings: services.flatMap((service) =>
      service.ports.length ? [] : [`${service.name} has no detected port and cannot expose a preview URL`],
    ),
  }
}

export function previewServiceSlug(value: string) {
  return safeName(value)
}

export function pathInsidePreviewWorktree(root: string, candidate: string) {
  return inside(root, candidate)
}
