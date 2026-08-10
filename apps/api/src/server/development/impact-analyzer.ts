import type {
  DevelopmentConfidence,
  DevelopmentSubject,
  ImpactAnalysisResult,
  ImpactChangedFile,
  ImpactChangedFileStatus,
  ImpactDeliveryEffect,
  ImpactNode,
  ImpactReasonEdge,
  ImpactValidationKind,
  ImpactValidationTarget,
  ImpactWarning,
} from '@vertexade/platform-contracts'

export const impactAnalyzerVersion = '1.0.0'

const maximumChangedFiles = 5_000
const maximumTrackedFiles = 100_000
const maximumManifestBytes = 1_000_000

export type ImpactCommandOptions = {
  cwd?: string
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
}

export type ImpactCommandRunner = (command: string, args: string[], options?: ImpactCommandOptions) => Promise<string>

export type ImpactAnalyzerRepository = {
  id: number
  fullName: string
  localPath: string
}

type PackageManifest = {
  name: string | null
  private: boolean
  scripts: Record<string, string>
  dependencies: string[]
}

type Project = PackageManifest & {
  key: string
  label: string
  rootPath: string
  manifestPath: string | null
}

type ChangedPath = Omit<ImpactChangedFile, 'projectKey'>

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringRecord(value: unknown): Record<string, string> {
  const source = record(value)
  if (!source) return {}
  return Object.fromEntries(
    Object.entries(source)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function dependencyNames(value: Record<string, unknown>): string[] {
  return [value.dependencies, value.devDependencies, value.peerDependencies, value.optionalDependencies]
    .flatMap((dependencies) => Object.keys(record(dependencies) || {}))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort()
}

function packageManifest(raw: string): PackageManifest {
  const value = record(JSON.parse(raw))
  if (!value) throw new Error('Package manifest must contain a JSON object')
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 300) : null,
    private: value.private === true,
    scripts: stringRecord(value.scripts),
    dependencies: dependencyNames(value),
  }
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function directory(path: string): string {
  const normalized = normalizedPath(path)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? '' : normalized.slice(0, separator)
}

function status(value: string): ImpactChangedFileStatus {
  if (value.startsWith('A')) return 'added'
  if (value.startsWith('M')) return 'modified'
  if (value.startsWith('D')) return 'deleted'
  if (value.startsWith('R')) return 'renamed'
  if (value.startsWith('C')) return 'copied'
  if (value.startsWith('T')) return 'type_changed'
  if (value.startsWith('U')) return 'unmerged'
  return 'unknown'
}

export function parseGitNameStatus(output: string): ChangedPath[] {
  const tokens = output.split('\0')
  const changed: ChangedPath[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index++] || ''
    if (!token) continue
    const tab = token.indexOf('\t')
    const statusToken = tab >= 0 ? token.slice(0, tab) : token
    let path = tab >= 0 ? token.slice(tab + 1) : tokens[index++] || ''
    let previousPath: string | null = null
    if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
      previousPath = normalizedPath(path)
      path = tokens[index++] || ''
    }
    const normalized = normalizedPath(path)
    if (!normalized) continue
    changed.push({
      path: normalized,
      previousPath,
      status: status(statusToken),
    })
  }
  return changed
}

function projectForPath(projects: Project[], path: string): Project {
  return (
    [...projects]
      .sort((left, right) => right.rootPath.length - left.rootPath.length)
      .find((project) => !project.rootPath || path === project.rootPath || path.startsWith(`${project.rootPath}/`)) || projects[0]!
  )
}

function projectKey(rootPath: string): string {
  return rootPath ? `project:${rootPath}` : 'project:.'
}

function fileKey(path: string): string {
  return `file:${path}`
}

function validationKind(script: string): ImpactValidationKind | null {
  const normalized = script.toLowerCase().replaceAll('_', '-')
  if (/(^|:|-)(e2e|end-to-end)($|:|-)/.test(normalized)) return 'end_to_end'
  if (/(^|:|-)integration($|:|-)/.test(normalized)) return 'integration'
  if (/(^|:|-)test($|:|-)/.test(normalized)) return 'test'
  if (/(type-?check|check:?types)/.test(normalized)) return 'typecheck'
  if (/(^|:|-)lint($|:|-)/.test(normalized)) return 'lint'
  if (/(^|:|-)build($|:|-)/.test(normalized)) return 'build'
  if (/(^|:|-)(check|verify)($|:|-)/.test(normalized)) return 'check'
  return null
}

function contractKind(path: string): ImpactNode['kind'] | null {
  const normalized = path.toLowerCase()
  if (/(^|\/)(migrations?|schema)(\/|\.|$)/.test(normalized) || /(^|\/)drizzle\//.test(normalized)) return 'database'
  if (
    /(^|\/)(contracts?|openapi|graphql|proto)(\/|\.|$)/.test(normalized) ||
    /(^|\/)src\/(index|public)(\.|\/)/.test(normalized) ||
    /(^|\/)api(\/|\.)/.test(normalized)
  )
    return 'public_contract'
  if (/(^|\/)(package\.json|[^/]*config\.[^/]+|tsconfig[^/]*\.json|pnpm-workspace\.yaml|[^/]*lock[^/]*)$/.test(normalized))
    return 'configuration'
  return null
}

function deliveryKind(path: string): ImpactDeliveryEffect['kind'] | null {
  const normalized = path.toLowerCase()
  if (normalized.startsWith('.github/workflows/')) return 'workflow'
  if (/(^|\/)(dockerfile|deploy|deployment|helm|k8s|kubernetes|terraform|vercel)(\.|\/|$)/.test(normalized)) return 'deployment'
  return null
}

function confidence(direct: boolean): DevelopmentConfidence {
  return direct ? 'high' : 'medium'
}

function addNode(nodes: Map<string, ImpactNode>, node: ImpactNode): void {
  const current = nodes.get(node.key)
  if (!current || (!current.direct && node.direct)) nodes.set(node.key, node)
}

async function trackedPaths(
  repository: ImpactAnalyzerRepository,
  headRevision: string,
  run: ImpactCommandRunner,
  signal?: AbortSignal,
): Promise<{ paths: string[]; truncated: boolean }> {
  const output = await run('git', ['-C', repository.localPath, 'ls-tree', '-r', '--name-only', '-z', headRevision], {
    signal,
    timeoutMs: 30_000,
    maxOutputBytes: 20 * 1024 * 1024,
  })
  const all = output.split('\0').map(normalizedPath).filter(Boolean)
  return { paths: all.slice(0, maximumTrackedFiles), truncated: all.length > maximumTrackedFiles }
}

async function readManifest(
  repository: ImpactAnalyzerRepository,
  revision: string,
  path: string,
  run: ImpactCommandRunner,
  signal?: AbortSignal,
): Promise<PackageManifest> {
  const raw = await run('git', ['-C', repository.localPath, 'show', `${revision}:${path}`], {
    signal,
    timeoutMs: 10_000,
    maxOutputBytes: maximumManifestBytes,
  })
  return packageManifest(raw)
}

async function discoverProjects(
  repository: ImpactAnalyzerRepository,
  revision: string,
  paths: string[],
  run: ImpactCommandRunner,
  warnings: ImpactWarning[],
  signal?: AbortSignal,
): Promise<Project[]> {
  const manifests = paths.filter((path) => path === 'package.json' || path.endsWith('/package.json')).sort()
  const projects: Project[] = []
  for (const manifestPath of manifests) {
    try {
      const manifest = await readManifest(repository, revision, manifestPath, run, signal)
      const rootPath = directory(manifestPath)
      projects.push({
        ...manifest,
        key: projectKey(rootPath),
        label: manifest.name || rootPath || repository.fullName,
        rootPath,
        manifestPath,
      })
    } catch (error) {
      warnings.push({
        code: 'manifest_unreadable',
        message: `${manifestPath} could not be analyzed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1_000),
        path: manifestPath,
      })
    }
  }
  if (!projects.some((project) => project.rootPath === '')) {
    projects.unshift({
      key: projectKey(''),
      label: repository.fullName,
      rootPath: '',
      manifestPath: null,
      name: null,
      private: true,
      scripts: {},
      dependencies: [],
    })
  }
  return projects.sort((left, right) => left.rootPath.localeCompare(right.rootPath))
}

function affectedProjects(projects: Project[], directKeys: Set<string>): Map<string, boolean> {
  const byPackageName = new Map(projects.filter((project) => project.name).map((project) => [project.name!, project]))
  const consumers = new Map<string, Project[]>()
  for (const consumer of projects) {
    for (const dependency of consumer.dependencies) {
      const provider = byPackageName.get(dependency)
      if (!provider) continue
      consumers.set(provider.key, [...(consumers.get(provider.key) || []), consumer])
    }
  }
  const affected = new Map<string, boolean>([...directKeys].map((key) => [key, true]))
  const queue = [...directKeys]
  while (queue.length) {
    const key = queue.shift()!
    for (const consumer of consumers.get(key) || []) {
      if (affected.has(consumer.key)) continue
      affected.set(consumer.key, false)
      queue.push(consumer.key)
    }
  }
  return affected
}

function addDependencyEdges(projects: Project[], affected: Map<string, boolean>, edges: ImpactReasonEdge[]): void {
  const byName = new Map(projects.filter((project) => project.name).map((project) => [project.name!, project]))
  for (const consumer of projects) {
    if (!affected.has(consumer.key)) continue
    for (const dependency of consumer.dependencies) {
      const provider = byName.get(dependency)
      if (!provider || !affected.has(provider.key)) continue
      edges.push({
        from: provider.key,
        to: consumer.key,
        relation: 'consumed_by',
        summary: `${consumer.label} depends on ${provider.label}`,
        sourcePath: consumer.manifestPath,
        confidence: 'high',
      })
    }
  }
}

function validationTargets(
  projects: Project[],
  affected: Map<string, boolean>,
  nodes: Map<string, ImpactNode>,
  edges: ImpactReasonEdge[],
  warnings: ImpactWarning[],
): ImpactValidationTarget[] {
  const targets: ImpactValidationTarget[] = []
  for (const project of projects.filter((candidate) => affected.has(candidate.key))) {
    const projectTargets = Object.keys(project.scripts)
      .map((script) => ({ script, kind: validationKind(script) }))
      .filter((candidate): candidate is { script: string; kind: ImpactValidationKind } => candidate.kind !== null)
    if (!projectTargets.length) {
      warnings.push({
        code: 'validation_gap',
        message: `No validation script was discovered for affected project ${project.label}`,
        path: project.manifestPath,
      })
    }
    for (const target of projectTargets) {
      const id = `${project.key}:script:${target.script}`
      const direct = affected.get(project.key) === true
      const reason = direct ? `${project.label} owns changed files` : `${project.label} consumes an affected workspace package`
      targets.push({
        id,
        projectKey: project.key,
        projectLabel: project.label,
        kind: target.kind,
        script: target.script,
        reason,
        required: true,
        confidence: confidence(direct),
      })
      addNode(nodes, {
        key: id,
        kind: 'test',
        label: `${project.label}: ${target.script}`,
        path: project.manifestPath,
        direct,
        confidence: confidence(direct),
      })
      edges.push({
        from: project.key,
        to: id,
        relation: 'validated_by',
        summary: reason,
        sourcePath: project.manifestPath,
        confidence: confidence(direct),
      })
    }
  }
  return targets.sort((left, right) => left.id.localeCompare(right.id))
}

function addSpecialEffects(
  changedFiles: ImpactChangedFile[],
  nodes: Map<string, ImpactNode>,
  edges: ImpactReasonEdge[],
): { deliveryEffects: ImpactDeliveryEffect[]; contractChanges: number } {
  const deliveryEffects: ImpactDeliveryEffect[] = []
  let contractChanges = 0
  for (const file of changedFiles) {
    const contract = contractKind(file.path)
    if (contract) {
      contractChanges += 1
      const key = `${contract}:${file.path}`
      addNode(nodes, { key, kind: contract, label: file.path, path: file.path, direct: true, confidence: 'medium' })
      edges.push({
        from: fileKey(file.path),
        to: key,
        relation:
          contract === 'database' ? 'changes_database' : contract === 'configuration' ? 'changes_configuration' : 'changes_contract',
        summary: `${file.path} matches a ${contract.replaceAll('_', ' ')} boundary`,
        sourcePath: file.path,
        confidence: 'medium',
      })
    }
    const delivery = deliveryKind(file.path)
    if (!delivery) continue
    const id = `${delivery}:${file.path}`
    deliveryEffects.push({
      id,
      kind: delivery,
      label: file.path,
      path: file.path,
      reason: `${file.path} is part of repository delivery configuration`,
      confidence: 'high',
    })
    addNode(nodes, {
      key: id,
      kind: delivery === 'workflow' ? 'workflow' : 'deployment',
      label: file.path,
      path: file.path,
      direct: true,
      confidence: 'high',
    })
    edges.push({
      from: fileKey(file.path),
      to: id,
      relation: 'changes_delivery',
      summary: `${file.path} changes ${delivery} behavior`,
      sourcePath: file.path,
      confidence: 'high',
    })
  }
  return { deliveryEffects: deliveryEffects.sort((left, right) => left.id.localeCompare(right.id)), contractChanges }
}

export async function analyzeRepositoryImpact({
  repository,
  subject,
  run,
  signal,
}: {
  repository: ImpactAnalyzerRepository
  subject: DevelopmentSubject
  run: ImpactCommandRunner
  signal?: AbortSignal
}): Promise<ImpactAnalysisResult> {
  const warnings: ImpactWarning[] = []
  const diff = await run(
    'git',
    ['-C', repository.localPath, 'diff', '--name-status', '-z', '--find-renames', subject.baseRevision, subject.headRevision, '--'],
    { signal, timeoutMs: 30_000, maxOutputBytes: 20 * 1024 * 1024 },
  )
  const parsedChangedFiles = parseGitNameStatus(diff)
  if (parsedChangedFiles.length > maximumChangedFiles) {
    warnings.push({
      code: 'changed_files_truncated',
      message: `The diff contains ${parsedChangedFiles.length} changed files; analysis was limited to ${maximumChangedFiles}`,
      path: null,
    })
  }
  const changedPaths = parsedChangedFiles.slice(0, maximumChangedFiles)
  const tracked = await trackedPaths(repository, subject.headRevision, run, signal)
  if (tracked.truncated) {
    warnings.push({
      code: 'tracked_files_truncated',
      message: `The repository contains more than ${maximumTrackedFiles} tracked files; project discovery was bounded`,
      path: null,
    })
  }
  const projects = await discoverProjects(repository, subject.headRevision, tracked.paths, run, warnings, signal)
  const changedFiles: ImpactChangedFile[] = changedPaths.map((file) => ({
    ...file,
    projectKey: projectForPath(projects, file.path).key,
  }))
  const directKeys = new Set(changedFiles.map((file) => file.projectKey))
  const affected = affectedProjects(projects, directKeys)
  const nodes = new Map<string, ImpactNode>()
  const edges: ImpactReasonEdge[] = []
  for (const file of changedFiles) {
    addNode(nodes, {
      key: fileKey(file.path),
      kind: 'file',
      label: file.path,
      path: file.path,
      direct: true,
      confidence: 'high',
    })
    const project = projects.find((candidate) => candidate.key === file.projectKey)!
    addNode(nodes, {
      key: project.key,
      kind: project.name ? 'package' : 'project',
      label: project.label,
      path: project.rootPath || '.',
      direct: true,
      confidence: 'high',
    })
    edges.push({
      from: fileKey(file.path),
      to: project.key,
      relation: 'owned_by',
      summary: `${file.path} belongs to ${project.label}`,
      sourcePath: project.manifestPath,
      confidence: 'high',
    })
  }
  for (const project of projects.filter((candidate) => affected.has(candidate.key))) {
    const direct = affected.get(project.key) === true
    addNode(nodes, {
      key: project.key,
      kind: project.name ? 'package' : 'project',
      label: project.label,
      path: project.rootPath || '.',
      direct,
      confidence: confidence(direct),
    })
  }
  addDependencyEdges(projects, affected, edges)
  const validations = validationTargets(projects, affected, nodes, edges, warnings)
  const special = addSpecialEffects(changedFiles, nodes, edges)
  const directProjects = [...affected.values()].filter(Boolean).length
  const transitiveProjects = affected.size - directProjects
  const risk =
    special.contractChanges > 0 || special.deliveryEffects.some((effect) => effect.kind === 'deployment')
      ? 'high'
      : transitiveProjects > 0 || changedFiles.length > 5
        ? 'medium'
        : 'low'
  return {
    analyzerVersion: impactAnalyzerVersion,
    repositoryName: repository.fullName,
    changedFiles,
    nodes: [...nodes.values()].sort((left, right) => left.key.localeCompare(right.key)),
    edges: edges.sort((left, right) =>
      `${left.from}:${left.to}:${left.relation}`.localeCompare(`${right.from}:${right.to}:${right.relation}`),
    ),
    validationTargets: validations,
    deliveryEffects: special.deliveryEffects,
    warnings,
    summary: {
      directProjects,
      transitiveProjects,
      requiredValidations: validations.filter((target) => target.required).length,
      deliveryEffects: special.deliveryEffects.length,
      contractChanges: special.contractChanges,
      risk,
    },
  }
}
