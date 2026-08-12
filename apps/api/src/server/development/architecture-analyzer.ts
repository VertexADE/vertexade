import type {
  ArchitectureDecision,
  ArchitectureDecisionRule,
  ArchitectureIndexResult,
  ArchitectureNode,
  ArchitectureNodeKind,
  ArchitectureRelation,
  ArchitectureSourceCitation,
  ImpactWarning,
} from '@vertexade/platform-contracts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'
import { buildRepositorySourceGraph, type RepositorySourceGraph } from './repository-source-graph.ts'

export const architectureIndexVersion = '1.2.0'

const maximumTrackedFiles = 100_000
const maximumIndexedDocuments = 500
const maximumDocumentBytes = 256 * 1024
const maximumDocumentTotalBytes = 4 * 1024 * 1024

export type ArchitectureAnalyzerRepository = {
  id: number
  fullName: string
  localPath: string
}

type TreeEntry = {
  path: string
  digest: string
}

type PackageEntry = {
  key: string
  label: string
  rootPath: string
  manifestPath: string
  dependencies: string[]
  citation: ArchitectureSourceCitation
  nodeKind: 'package' | 'service'
  packageName: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function directory(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function source(path: string, digest: string, startLine: number | null = null, endLine: number | null = null): ArchitectureSourceCitation {
  return { path, digest, startLine, endLine }
}

function parseTree(output: string): TreeEntry[] {
  const entries: TreeEntry[] = []
  for (const token of output.split('\0')) {
    if (!token) continue
    const match = token.match(/^\d+\s+blob\s+([a-f0-9]{40,64})\t(.+)$/)
    if (!match) continue
    const path = normalizedPath(match[2])
    if (path) entries.push({ path, digest: match[1] })
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function excludedPath(path: string): boolean {
  const normalized = path.toLowerCase()
  const name = normalized.split('/').at(-1) || ''
  return (
    normalized.startsWith('.git/') ||
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/build/') ||
    normalized.includes('/.output/') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(name) ||
    /(credentials?|secrets?)\.(json|ya?ml|toml)$/.test(name)
  )
}

async function repositoryTree(
  repository: ArchitectureAnalyzerRepository,
  revision: string,
  run: ImpactCommandRunner,
  signal?: AbortSignal,
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const output = await run('git', ['-C', repository.localPath, 'ls-tree', '-r', '-z', revision], {
    signal,
    timeoutMs: 30_000,
    maxOutputBytes: 30 * 1024 * 1024,
  })
  const all = parseTree(output).filter((entry) => !excludedPath(entry.path))
  return { entries: all.slice(0, maximumTrackedFiles), truncated: all.length > maximumTrackedFiles }
}

async function readSource(
  repository: ArchitectureAnalyzerRepository,
  revision: string,
  path: string,
  run: ImpactCommandRunner,
  signal?: AbortSignal,
): Promise<string> {
  return run('git', ['-C', repository.localPath, 'show', `${revision}:${path}`], {
    signal,
    timeoutMs: 10_000,
    maxOutputBytes: maximumDocumentBytes,
  })
}

function packageDependencies(value: Record<string, unknown>): string[] {
  return [value.dependencies, value.devDependencies, value.peerDependencies, value.optionalDependencies]
    .flatMap((entry) => Object.keys(record(entry) || {}))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort()
}

async function packages(
  repository: ArchitectureAnalyzerRepository,
  revision: string,
  entries: TreeEntry[],
  run: ImpactCommandRunner,
  warnings: ImpactWarning[],
  signal?: AbortSignal,
): Promise<PackageEntry[]> {
  const result: PackageEntry[] = []
  for (const entry of entries.filter(({ path }) => path === 'package.json' || path.endsWith('/package.json'))) {
    try {
      const value = record(JSON.parse(await readSource(repository, revision, entry.path, run, signal)))
      if (!value) throw new Error('manifest must be a JSON object')
      const rootPath = directory(entry.path)
      const packageName = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null
      const name = packageName || rootPath || repository.fullName
      result.push({
        key: `architecture:${rootPath.startsWith('apps/') ? 'service' : 'package'}:${rootPath || '.'}`,
        label: name.slice(0, 300),
        rootPath,
        manifestPath: entry.path,
        dependencies: packageDependencies(value),
        citation: source(entry.path, entry.digest),
        nodeKind: rootPath.startsWith('apps/') ? 'service' : 'package',
        packageName,
      })
    } catch (error) {
      warnings.push({
        code: 'architecture_manifest_unreadable',
        message: `${entry.path} could not be indexed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1_000),
        path: entry.path,
      })
    }
  }
  return result.sort((left, right) => left.rootPath.localeCompare(right.rootPath))
}

function firstParagraph(lines: string[], headingLine: number): string | null {
  const values: string[] = []
  for (let index = headingLine + 1; index < lines.length; index += 1) {
    const value = lines[index].trim()
    if (!value && values.length) break
    if (!value || value.startsWith('#') || value.startsWith('```')) continue
    values.push(value)
    if (values.join(' ').length >= 500) break
  }
  return values.join(' ').slice(0, 500) || null
}

function documentNode(entry: TreeEntry, content: string): ArchitectureNode {
  const lines = content.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line))
  const title = headingIndex >= 0 ? lines[headingIndex].replace(/^#\s+/, '').trim() : entry.path.split('/').at(-1) || entry.path
  return {
    key: `architecture:document:${entry.path}`,
    kind: 'document',
    label: title.slice(0, 300),
    summary: headingIndex >= 0 ? firstParagraph(lines, headingIndex) : null,
    path: entry.path,
    citations: [source(entry.path, entry.digest, headingIndex >= 0 ? headingIndex + 1 : null, headingIndex >= 0 ? headingIndex + 1 : null)],
  }
}

function decisionStatus(content: string): ArchitectureDecision['status'] {
  const match = content.match(/^\s*(?:status\s*:\s*|\*\*status\*\*\s*:?\s*)([^\n]+)$/im)
  const value = String(match?.[1] || '').toLowerCase()
  if (value.includes('accept')) return 'accepted'
  if (value.includes('propos')) return 'proposed'
  if (value.includes('deprecat')) return 'deprecated'
  if (value.includes('supersed')) return 'superseded'
  return 'unknown'
}

function mentionedArchitectureNodes(content: string, nodes: ArchitectureNode[]): ArchitectureNode[] {
  const normalized = content.toLowerCase()
  return nodes.filter((node) => {
    if (node.kind === 'repository' || node.kind === 'document') return false
    const candidates = [node.label, node.path || '']
      .flatMap((value) => [value, ...value.split(/[/@._-]+/)])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length >= 4)
    return candidates.some((value) => normalized.includes(value))
  })
}

function decisionValidationKinds(content: string): ArchitectureDecisionRule['validationKinds'] {
  const kinds = new Set<ArchitectureDecisionRule['validationKinds'][number]>()
  if (/contract|api|schema|type/i.test(content)) kinds.add('typecheck')
  if (/contract|api|database|schema|migration|integration/i.test(content)) kinds.add('integration')
  if (/deploy|delivery|workflow|release|build/i.test(content)) kinds.add('build')
  if (/security|authentication|authorization|end[- ]to[- ]end|e2e/i.test(content)) kinds.add('end_to_end')
  if (/\btests?\b|verification|validate/i.test(content)) kinds.add('test')
  return [...kinds]
}

function architectureDecisionRule(content: string, nodes: ArchitectureNode[]): ArchitectureDecisionRule | null {
  const matched = mentionedArchitectureNodes(content, nodes)
  const explicitPaths = [...content.matchAll(/`([^`]*(?:\/|\.[a-z0-9]{1,8})[^`]*)`/gi)]
    .map((match) => normalizedPath(match[1].replace(/[*{}]/g, '')))
    .filter((path) => path && !path.includes(' '))
  const paths = [...new Set([...explicitPaths, ...matched.map((node) => node.path).filter((path): path is string => Boolean(path))])].sort()
  if (!paths.length && !matched.length) return null
  const highImpact =
    /public contract|breaking|database|schema|migration|security|authentication|authorization|deploy|delivery|cross[- ]service/i.test(
      content,
    ) || matched.some((node) => ['api', 'event', 'datastore', 'deployment'].includes(node.kind))
  const sentence = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !line.startsWith('#') && !/^status\s*:/i.test(line) && line.length > 20)
  return {
    paths,
    nodeKeys: matched.map((node) => node.key).sort(),
    impact: highImpact ? 'high' : 'medium',
    validationKinds: decisionValidationKinds(content),
    rationale: (sentence || 'The architecture decision applies to this boundary.').slice(0, 500),
    confidence: explicitPaths.length ? 'high' : 'medium',
  }
}

function architectureDecision(
  entry: TreeEntry,
  content: string,
  node: ArchitectureNode,
  nodes: ArchitectureNode[],
): ArchitectureDecision | null {
  const normalized = entry.path.toLowerCase()
  if (!/(^|\/)(adr|adrs|decisions?)(\/|[-_.])/.test(normalized) && !/\barchitecture decision\b/i.test(content.slice(0, 2_000))) return null
  const filename =
    entry.path
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') || node.label
  const identifier = node.label.match(/\bADR[-_ ]?\d+\b/i)?.[0] || filename
  const supersedes =
    content
      .match(/\bsupersedes?\s*:\s*([^\n]+)/i)?.[1]
      ?.trim()
      .slice(0, 200) || null
  const scope =
    content
      .match(/\bscope\s*:\s*([^\n]+)/i)?.[1]
      ?.trim()
      .slice(0, 300) || null
  return {
    id: identifier.toLowerCase().replace(/\s+/g, '-').slice(0, 200),
    title: node.label,
    status: decisionStatus(content),
    scope,
    supersedes,
    citation: node.citations[0],
    rule: architectureDecisionRule(content, nodes),
  }
}

function specialKind(path: string): ArchitectureNodeKind | null {
  const normalized = path.toLowerCase()
  if (normalized.startsWith('packages/extensions/')) return 'extension'
  if (normalized.startsWith('.github/workflows/') || /(^|\/)(dockerfile|deploy|helm|k8s|terraform|vercel)(\.|\/|$)/.test(normalized))
    return 'deployment'
  if (/(^|\/)(migrations?|schema)(\/|\.|$)/.test(normalized)) return 'datastore'
  if (/(^|\/)(openapi|graphql|proto|contracts?)(\/|\.|$)/.test(normalized) || /(^|\/)api(\/|\.)/.test(normalized)) return 'api'
  if (/(^|\/)(events?|messages?)(\/|\.)/.test(normalized)) return 'event'
  return null
}

function addNode(nodes: Map<string, ArchitectureNode>, node: ArchitectureNode): void {
  if (!nodes.has(node.key)) nodes.set(node.key, node)
}

function specialOwner(entry: TreeEntry, packageEntries: PackageEntry[]): PackageEntry | null {
  return (
    packageEntries
      .filter((candidate) => !candidate.rootPath || entry.path.startsWith(`${candidate.rootPath}/`))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0] || null
  )
}

function specialRelation(kind: ArchitectureNodeKind, path: string): ArchitectureRelation['relation'] {
  if (kind === 'deployment') return 'deploys_as'
  if (kind === 'datastore') return 'persists_to'
  if (kind !== 'event') return 'exposes'
  return /(^|\/)(consumers?|handlers?|subscribers?)(\/|\.|-)/i.test(path) ? 'consumes' : 'publishes'
}

function specialBoundary(
  entry: TreeEntry,
  repositoryKey: string,
  packageEntries: PackageEntry[],
): { node: ArchitectureNode; relation: ArchitectureRelation } | null {
  const kind = specialKind(entry.path)
  if (!kind) return null
  const key = `architecture:${kind}:${entry.path}`
  const citation = source(entry.path, entry.digest)
  const owner = specialOwner(entry, packageEntries)
  return {
    node: { key, kind, label: entry.path, summary: null, path: entry.path, citations: [citation] },
    relation: {
      from: owner?.key || repositoryKey,
      to: key,
      relation: specialRelation(kind, entry.path),
      summary: `${owner?.label || 'Repository'} declares ${entry.path} as a ${kind} boundary`,
      confidence: kind === 'extension' ? 'medium' : 'high',
      citation,
    },
  }
}

function specialNodes(
  entries: TreeEntry[],
  repositoryKey: string,
  packageEntries: PackageEntry[],
  nodes: Map<string, ArchitectureNode>,
  relations: ArchitectureRelation[],
): void {
  for (const entry of entries) {
    const boundary = specialBoundary(entry, repositoryKey, packageEntries)
    if (!boundary) continue
    addNode(nodes, boundary.node)
    relations.push(boundary.relation)
  }
}

function sourceRelations(graph: RepositorySourceGraph, entries: TreeEntry[], existing: ArchitectureRelation[]): ArchitectureRelation[] {
  const digests = new Map(entries.map((entry) => [entry.path, entry.digest]))
  const identities = new Set(existing.map((relation) => `${relation.from}:${relation.to}:${relation.relation}`))
  const result: ArchitectureRelation[] = []
  for (const edge of graph.edges) {
    if (edge.fromBoundaryKey === edge.toBoundaryKey) continue
    const identity = `${edge.fromBoundaryKey}:${edge.toBoundaryKey}:depends_on`
    if (identities.has(identity)) continue
    identities.add(identity)
    result.push({
      from: edge.fromBoundaryKey,
      to: edge.toBoundaryKey,
      relation: 'depends_on',
      summary: `${edge.fromPath}:${edge.line} ${edge.kind.replaceAll('_', ' ')}s ${edge.specifier}`,
      confidence: edge.confidence,
      citation: source(edge.fromPath, digests.get(edge.fromPath) || graph.digest, edge.line, edge.line),
    })
  }
  return result
}

function packageRelations(packageEntries: PackageEntry[], repositoryKey: string): ArchitectureRelation[] {
  const byName = new Map(packageEntries.map((entry) => [entry.label, entry]))
  const relations: ArchitectureRelation[] = packageEntries.map((entry) => ({
    from: repositoryKey,
    to: entry.key,
    relation: 'contains',
    summary: `${entry.label} is defined by ${entry.manifestPath}`,
    confidence: 'high',
    citation: entry.citation,
  }))
  for (const consumer of packageEntries) {
    for (const dependency of consumer.dependencies) {
      const provider = byName.get(dependency)
      if (!provider) continue
      relations.push({
        from: consumer.key,
        to: provider.key,
        relation: 'depends_on',
        summary: `${consumer.label} depends on ${provider.label}`,
        confidence: 'high',
        citation: consumer.citation,
      })
    }
  }
  return relations
}

function decisionConflicts(decisions: ArchitectureDecision[], warnings: ImpactWarning[]): void {
  const grouped = new Map<string, ArchitectureDecision[]>()
  for (const decision of decisions) {
    const key = decision.id || decision.title.toLowerCase()
    grouped.set(key, [...(grouped.get(key) || []), decision])
  }
  for (const [key, candidates] of grouped) {
    if (new Set(candidates.map((decision) => decision.status)).size <= 1) continue
    warnings.push({
      code: 'architecture_decision_conflict',
      message: `Architecture decision ${key} has conflicting statuses: ${candidates.map((decision) => decision.status).join(', ')}`,
      path: candidates[0]?.citation.path || null,
    })
  }
}

export async function analyzeRepositoryArchitecture({
  repository,
  revision,
  run,
  signal,
}: {
  repository: ArchitectureAnalyzerRepository
  revision: string
  run: ImpactCommandRunner
  signal?: AbortSignal
}): Promise<ArchitectureIndexResult> {
  const warnings: ImpactWarning[] = []
  const tree = await repositoryTree(repository, revision, run, signal)
  if (tree.truncated) {
    warnings.push({
      code: 'architecture_tree_truncated',
      message: `Architecture indexing was limited to ${maximumTrackedFiles} tracked files`,
      path: null,
    })
  }
  const packageEntries = await packages(repository, revision, tree.entries, run, warnings, signal)
  const repositoryKey = 'architecture:repository:.'
  const nodes = new Map<string, ArchitectureNode>()
  nodes.set(repositoryKey, {
    key: repositoryKey,
    kind: 'repository',
    label: repository.fullName,
    summary: null,
    path: '.',
    citations: [],
  })
  for (const entry of packageEntries) {
    nodes.set(entry.key, {
      key: entry.key,
      kind: entry.nodeKind,
      label: entry.label,
      summary: null,
      path: entry.rootPath || '.',
      citations: [entry.citation],
    })
  }
  const relations = packageRelations(packageEntries, repositoryKey)
  const sourceGraph = await buildRepositorySourceGraph({
    repository,
    revision,
    paths: tree.entries.map((entry) => entry.path),
    boundaries: [
      ...packageEntries.map((entry) => ({ key: entry.key, rootPath: entry.rootPath, packageName: entry.packageName })),
      ...(packageEntries.some((entry) => entry.rootPath === '') ? [] : [{ key: repositoryKey, rootPath: '', packageName: null }]),
    ],
    run,
    signal,
  })
  warnings.push(...sourceGraph.warnings)
  relations.push(...sourceRelations(sourceGraph, tree.entries, relations))
  specialNodes(tree.entries, repositoryKey, packageEntries, nodes, relations)

  const documentEntries = tree.entries
    .filter(({ path }) => /(^|\/)(readme|architecture|adr|adrs|decisions?)[^/]*\.md$/i.test(path) || /^(docs|design)\/.*\.md$/i.test(path))
    .slice(0, maximumIndexedDocuments)
  if (documentEntries.length === maximumIndexedDocuments) {
    warnings.push({
      code: 'architecture_documents_truncated',
      message: `Architecture document indexing was limited to ${maximumIndexedDocuments} files`,
      path: null,
    })
  }
  const decisions: ArchitectureDecision[] = []
  let documentBytes = 0
  for (const entry of documentEntries) {
    if (documentBytes >= maximumDocumentTotalBytes) {
      warnings.push({
        code: 'architecture_document_budget_exhausted',
        message: `Architecture document content was limited to ${maximumDocumentTotalBytes} bytes`,
        path: entry.path,
      })
      break
    }
    try {
      const content = await readSource(repository, revision, entry.path, run, signal)
      documentBytes += Buffer.byteLength(content)
      const node = documentNode(entry, content)
      addNode(nodes, node)
      relations.push({
        from: node.key,
        to: repositoryKey,
        relation: 'documents',
        summary: `${node.label} documents repository architecture`,
        confidence: 'medium',
        citation: node.citations[0],
      })
      const decision = architectureDecision(entry, content, node, [...nodes.values()])
      if (decision) decisions.push(decision)
    } catch (error) {
      warnings.push({
        code: 'architecture_document_unreadable',
        message: `${entry.path} could not be indexed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1_000),
        path: entry.path,
      })
    }
  }
  decisionConflicts(decisions, warnings)
  const values = [...nodes.values()].sort((left, right) => left.key.localeCompare(right.key))
  return {
    indexVersion: architectureIndexVersion,
    sourceGraph: {
      version: sourceGraph.version,
      revision: sourceGraph.revision,
      digest: sourceGraph.digest,
      sourceFileCount: sourceGraph.sourceFileCount,
      edgeCount: sourceGraph.edgeCount,
    },
    repositoryName: repository.fullName,
    revision,
    nodes: values,
    relations: relations.sort((left, right) =>
      `${left.from}:${left.to}:${left.relation}`.localeCompare(`${right.from}:${right.to}:${right.relation}`),
    ),
    decisions: decisions.sort((left, right) => left.id.localeCompare(right.id)),
    warnings,
    summary: {
      packages: values.filter((node) => node.kind === 'package').length,
      services: values.filter((node) => node.kind === 'service').length,
      contracts: values.filter((node) => ['api', 'event', 'datastore'].includes(node.kind)).length,
      deployments: values.filter((node) => node.kind === 'deployment').length,
      decisions: decisions.length,
    },
  }
}
