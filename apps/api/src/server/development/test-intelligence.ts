import type { ImpactAnalysis, ImpactValidationKind, TestCatalog, TestSelection, TestTarget } from '@vertexade/platform-contracts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'

const executables = ['pnpm', 'npm', 'yarn', 'bun', 'node'] as const
const validationKinds = ['test', 'typecheck', 'lint', 'build', 'integration', 'end_to_end', 'check'] as const

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} characters without control characters`)
  }
  return result
}

function normalizedWorkingDirectory(value: unknown): string {
  const result = String(value ?? '.')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
  if (!result || result === '.') return '.'
  const segments = result.split('/')
  if (result.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Test target working directory must be a normalized repository-relative path')
  }
  return boundedText(result, 'Test target working directory', 1_000)
}

function normalizedArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Test target arguments must be an array of at most 100 values')
  return value.map((argument) => {
    const result = String(argument)
    if (result.length > 2_000 || /[\u0000\r\n]/.test(result))
      throw new Error('Test target arguments may not exceed 2,000 characters or contain control lines')
    return result
  })
}

function normalizedArtifactPaths(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error('Test target artifact paths must be an array of at most 50 values')
  return [...new Set(value.map((path) => normalizedWorkingDirectory(path)).filter((path) => path !== '.'))]
}

export function normalizeTestTargetOverride(repositoryId: number, input: unknown): TestTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Test target override must be an object')
  const value = input as Record<string, unknown>
  const executable = String(value.executable || '') as TestTarget['executable']
  if (!executables.includes(executable)) throw new Error(`Test target executable must be one of: ${executables.join(', ')}`)
  const kind = String(value.kind || '') as ImpactValidationKind
  if (!validationKinds.includes(kind)) throw new Error(`Test target kind must be one of: ${validationKinds.join(', ')}`)
  const timeoutMs = Number(value.timeoutMs)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) {
    throw new Error('Test target timeout must be between 1 second and 30 minutes')
  }
  const id = boundedText(value.id, 'Test target ID', 300)
  if (!/^[a-z0-9][a-z0-9:._/-]*$/i.test(id)) throw new Error('Test target ID contains unsupported characters')
  return {
    id,
    repositoryId,
    projectKey: boundedText(value.projectKey, 'Project key', 500),
    projectLabel: boundedText(value.projectLabel, 'Project label', 300),
    kind,
    label: boundedText(value.label, 'Test target label', 300),
    script: boundedText(value.script, 'Test target script', 300),
    executable,
    args: normalizedArgs(value.args),
    workingDirectory: normalizedWorkingDirectory(value.workingDirectory),
    timeoutMs,
    artifactPaths: normalizedArtifactPaths(value.artifactPaths),
    source: 'configured',
    confidence: 'high',
    enabled: value.enabled !== false,
  }
}

function packageManager(paths: Set<string>): TestCatalog['packageManager'] {
  if (paths.has('pnpm-lock.yaml')) return 'pnpm'
  if (paths.has('bun.lock') || paths.has('bun.lockb')) return 'bun'
  if (paths.has('yarn.lock')) return 'yarn'
  return 'npm'
}

function managerArgs(manager: TestCatalog['packageManager'], projectPath: string, script: string): string[] {
  if (manager === 'pnpm') return ['--dir', projectPath, 'run', script]
  if (manager === 'npm') return ['--prefix', projectPath, 'run', script]
  if (manager === 'yarn') return ['--cwd', projectPath, 'run', script]
  return ['--cwd', projectPath, 'run', script]
}

async function treePaths(repositoryPath: string, revision: string, run: ImpactCommandRunner, signal?: AbortSignal): Promise<Set<string>> {
  const output = await run('git', ['-C', repositoryPath, 'ls-tree', '-r', '--name-only', '-z', revision], {
    signal,
    timeoutMs: 30_000,
    maxOutputBytes: 20 * 1024 * 1024,
  })
  return new Set(output.split('\0').filter(Boolean))
}

export async function buildTestCatalog({
  repositoryId,
  repositoryPath,
  analysis,
  overrides,
  run,
  signal,
}: {
  repositoryId: number
  repositoryPath: string
  analysis: ImpactAnalysis
  overrides: TestTarget[]
  run: ImpactCommandRunner
  signal?: AbortSignal
}): Promise<TestCatalog> {
  const paths = await treePaths(repositoryPath, analysis.subject.headRevision, run, signal)
  const manager = packageManager(paths)
  const nodes = new Map(analysis.result.nodes.map((node) => [node.key, node]))
  const discovered = analysis.result.validationTargets.map<TestTarget>((target) => {
    const projectPath = nodes.get(target.projectKey)?.path || '.'
    return {
      id: target.id,
      repositoryId,
      projectKey: target.projectKey,
      projectLabel: target.projectLabel,
      kind: target.kind,
      label: `${target.projectLabel}: ${target.script}`,
      script: target.script,
      executable: manager,
      args: managerArgs(manager, projectPath, target.script),
      workingDirectory: '.',
      timeoutMs: target.kind === 'end_to_end' || target.kind === 'integration' ? 15 * 60_000 : 10 * 60_000,
      artifactPaths: [],
      source: 'discovered',
      confidence: target.confidence,
      enabled: true,
    }
  })
  const byId = new Map(discovered.map((target) => [target.id, target]))
  for (const override of overrides) byId.set(override.id, override)
  const warnings = [...analysis.result.warnings.filter((warning) => warning.code === 'validation_gap')]
  if (![...paths].some((path) => ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'].includes(path))) {
    warnings.push({
      code: 'package_manager_inferred',
      message: 'No lockfile was found at the repository root; npm was selected as the validation runner',
      path: null,
    })
  }
  return {
    repositoryId,
    revision: analysis.subject.headRevision,
    packageManager: manager,
    targets: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    warnings,
    generatedAt: new Date().toISOString(),
  }
}

export function selectTests(analysis: ImpactAnalysis, catalog: TestCatalog): TestSelection {
  const requiredIds = new Set(analysis.result.validationTargets.filter((target) => target.required).map((target) => target.id))
  const affectedProjects = new Set(
    analysis.result.nodes.filter((node) => ['project', 'package'].includes(node.kind)).map((node) => node.key),
  )
  const selected = catalog.targets.filter(
    (target) => target.enabled && (requiredIds.has(target.id) || affectedProjects.has(target.projectKey)),
  )
  const omissions = catalog.targets
    .filter((target) => !selected.some((candidate) => candidate.id === target.id))
    .map((target) => ({
      targetId: target.id,
      reason: target.enabled ? 'Target does not cover an affected project' : 'Target is disabled by repository configuration',
    }))
  const selectedProjects = new Set(selected.map((target) => target.projectKey))
  const coverageGaps = [
    ...catalog.warnings,
    ...[...affectedProjects]
      .filter((projectKey) => !selectedProjects.has(projectKey))
      .map((projectKey) => ({
        code: 'project_validation_uncovered',
        message: `No enabled validation target covers ${projectKey}`,
        path: analysis.result.nodes.find((node) => node.key === projectKey)?.path || null,
      })),
  ]
  return {
    impactAnalysisId: analysis.id,
    revision: analysis.subject.headRevision,
    selected,
    omissions,
    coverageGaps,
  }
}
