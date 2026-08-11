import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { DevelopmentSourceGraphSummary, ImpactWarning } from '@vertexade/platform-contracts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'

const repositorySourceGraphVersion = '1.0.0'

const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?)$/i
const resolutionExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const
const maximumGraphOutputBytes = 16 * 1024 * 1024
const maximumSourceEdges = 25_000

type RepositoryGraphBoundary = {
  key: string
  rootPath: string
  packageName: string | null
}

export type RepositorySourceEdge = {
  fromPath: string
  toPath: string
  fromBoundaryKey: string
  toBoundaryKey: string
  specifier: string
  line: number
  kind: 'import' | 'export' | 'dynamic_import' | 'require'
  confidence: 'high' | 'medium'
}

export type RepositorySourceGraph = DevelopmentSourceGraphSummary & {
  edges: RepositorySourceEdge[]
  warnings: ImpactWarning[]
}

type ImportReference = Pick<RepositorySourceEdge, 'specifier' | 'kind'>

type BuildRepositorySourceGraphInput = {
  repository: { localPath: string }
  revision: string
  paths: string[]
  resolutionPaths?: string[]
  boundaries: RepositoryGraphBoundary[]
  run: ImpactCommandRunner
  signal?: AbortSignal
}

function normalizedPath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function boundaryForPath(path: string, boundaries: RepositoryGraphBoundary[]): RepositoryGraphBoundary {
  return (
    boundaries
      .filter((boundary) => !boundary.rootPath || path === boundary.rootPath || path.startsWith(`${boundary.rootPath}/`))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0] || boundaries[0]
  )
}

function references(line: string): ImportReference[] {
  if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return []
  const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '')
  const result: ImportReference[] = []
  const patterns: Array<{ kind: ImportReference['kind']; expression: RegExp }> = [
    { kind: 'export', expression: /\bexport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g },
    { kind: 'import', expression: /\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g },
    { kind: 'dynamic_import', expression: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
    { kind: 'require', expression: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  ]
  for (const { kind, expression } of patterns) {
    for (const match of code.matchAll(expression)) {
      const specifier = String(match[1] || '').trim()
      if (specifier) result.push({ specifier, kind })
    }
  }
  return result
}

function sourceCandidates(basePath: string): string[] {
  const base = normalizedPath(basePath)
  if (sourceExtensionPattern.test(base)) return [base]
  return [
    base,
    ...resolutionExtensions.map((extension) => `${base}${extension}`),
    ...resolutionExtensions.map((extension) => `${base}/index${extension}`),
  ]
}

function relativeCandidates(fromPath: string, specifier: string): string[] {
  return sourceCandidates(posix.normalize(posix.join(posix.dirname(fromPath), specifier)))
}

function packageBoundary(specifier: string, boundaries: RepositoryGraphBoundary[]): RepositoryGraphBoundary | null {
  return (
    boundaries
      .filter(
        (boundary) => boundary.packageName && (specifier === boundary.packageName || specifier.startsWith(`${boundary.packageName}/`)),
      )
      .sort((left, right) => (right.packageName?.length || 0) - (left.packageName?.length || 0))[0] || null
  )
}

function packageTarget(boundary: RepositoryGraphBoundary, specifier: string, sourceFiles: Set<string>): string | null {
  const subpath = boundary.packageName ? specifier.slice(boundary.packageName.length).replace(/^\//, '') : ''
  const candidates = [
    ...(subpath
      ? [...sourceCandidates(posix.join(boundary.rootPath, subpath)), ...sourceCandidates(posix.join(boundary.rootPath, 'src', subpath))]
      : []),
    ...resolutionExtensions.map((extension) => normalizedPath(posix.join(boundary.rootPath, `src/index${extension}`))),
    ...resolutionExtensions.map((extension) => normalizedPath(posix.join(boundary.rootPath, `index${extension}`))),
  ]
  return candidates.find((candidate) => sourceFiles.has(candidate)) || null
}

function resolvedTarget(
  fromPath: string,
  specifier: string,
  sourceFiles: Set<string>,
  boundaries: RepositoryGraphBoundary[],
): { path: string; confidence: RepositorySourceEdge['confidence'] } | null {
  if (specifier.startsWith('.')) {
    const path = relativeCandidates(fromPath, specifier).find((candidate) => sourceFiles.has(candidate))
    return path ? { path, confidence: 'high' } : null
  }
  const boundary = packageBoundary(specifier, boundaries)
  if (!boundary) return null
  const path = packageTarget(boundary, specifier, sourceFiles)
  return path ? { path, confidence: 'medium' } : null
}

function parseGrepLine(line: string): { path: string; line: number; content: string } | null {
  const match = line.match(/^[^:]+:(.+?):(\d+):(.*)$/)
  if (!match) return null
  const lineNumber = Number(match[2])
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) return null
  return { path: normalizedPath(match[1]), line: lineNumber, content: match[3] }
}

async function sourceGraphOutput(input: BuildRepositorySourceGraphInput, warnings: ImpactWarning[]): Promise<string> {
  try {
    return await input.run(
      'git',
      ['-C', input.repository.localPath, 'grep', '-n', '-I', '-E', '(import|export|require)', input.revision, '--'],
      { signal: input.signal, timeoutMs: 60_000, maxOutputBytes: maximumGraphOutputBytes },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/exit(?:ed)? (?:with )?(?:code )?1\b/i.test(message)) {
      warnings.push({
        code: 'source_graph_unavailable',
        message: `Source import graph could not be built: ${message}`.slice(0, 1_000),
        path: null,
      })
    }
    return ''
  }
}

function appendSourceReferences(
  parsed: { path: string; line: number; content: string },
  sourceFiles: Set<string>,
  boundaries: RepositoryGraphBoundary[],
  edges: RepositorySourceEdge[],
  identities: Set<string>,
): void {
  const fromBoundary = boundaryForPath(parsed.path, boundaries)
  for (const reference of references(parsed.content)) {
    const target = resolvedTarget(parsed.path, reference.specifier, sourceFiles, boundaries)
    if (!target || target.path === parsed.path) continue
    const identity = `${parsed.path}:${parsed.line}:${reference.kind}:${target.path}`
    if (identities.has(identity)) continue
    identities.add(identity)
    edges.push({
      fromPath: parsed.path,
      toPath: target.path,
      fromBoundaryKey: fromBoundary.key,
      toBoundaryKey: boundaryForPath(target.path, boundaries).key,
      specifier: reference.specifier,
      line: parsed.line,
      kind: reference.kind,
      confidence: target.confidence,
    })
    if (edges.length === maximumSourceEdges) return
  }
}

function sourceGraphEdges(output: string, sourceFiles: Set<string>, boundaries: RepositoryGraphBoundary[]): RepositorySourceEdge[] {
  const edges: RepositorySourceEdge[] = []
  const identities = new Set<string>()
  for (const rawLine of output.split('\n')) {
    const parsed = parseGrepLine(rawLine)
    if (!parsed || !sourceFiles.has(parsed.path)) continue
    appendSourceReferences(parsed, sourceFiles, boundaries, edges, identities)
    if (edges.length === maximumSourceEdges) break
  }
  return edges
}

export async function buildRepositorySourceGraph(input: BuildRepositorySourceGraphInput): Promise<RepositorySourceGraph> {
  if (!input.boundaries.length) throw new Error('A source graph requires at least one repository boundary')
  const warnings: ImpactWarning[] = []
  const sourceFiles = new Set(
    [...input.paths, ...(input.resolutionPaths || [])].map(normalizedPath).filter((path) => sourceExtensionPattern.test(path)),
  )
  const output = await sourceGraphOutput(input, warnings)
  const edges = sourceGraphEdges(output, sourceFiles, input.boundaries)
  if (edges.length >= maximumSourceEdges) {
    warnings.push({
      code: 'source_graph_truncated',
      message: `Source import graph was limited to ${maximumSourceEdges} edges`,
      path: null,
    })
  }
  edges.sort((left, right) =>
    `${left.fromPath}:${left.line}:${left.toPath}:${left.kind}`.localeCompare(
      `${right.fromPath}:${right.line}:${right.toPath}:${right.kind}`,
    ),
  )
  return {
    version: repositorySourceGraphVersion,
    revision: input.revision,
    digest: createHash('sha256').update(JSON.stringify(edges)).digest('hex'),
    sourceFileCount: sourceFiles.size,
    edgeCount: edges.length,
    edges,
    warnings,
  }
}
