import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type {
  DependencyUpgradeRecipeConfiguration,
  ImpactValidationKind,
  MigrationPredictedChange,
  MigrationRecipeConfiguration,
} from '@vertexade/platform-contracts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} characters without control characters`)
  }
  return result
}

function isWithin(root: string, candidate: string): boolean {
  const relation = relative(root, candidate)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')
}

export function normalizeDependencyConfiguration(input: unknown): DependencyUpgradeRecipeConfiguration {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recipe configuration must be an object')
  const value = input as Record<string, unknown>
  const packageName = boundedText(value.packageName, 'Package name', 214)
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(packageName)) throw new Error('Package name is invalid')
  const targetVersion = boundedText(value.targetVersion, 'Target version', 100)
  if (!/^[a-z0-9][a-z0-9._+\-^~<>=*| ]*$/i.test(targetVersion)) throw new Error('Target version is invalid')
  const allowedSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
  const requestedSections = Array.isArray(value.sections) ? value.sections.map(String) : [...allowedSections]
  if (
    !requestedSections.length ||
    requestedSections.some((section) => !allowedSections.includes(section as (typeof allowedSections)[number]))
  ) {
    throw new Error('Dependency sections are invalid')
  }
  return {
    kind: 'dependency_upgrade',
    packageName,
    targetVersion,
    sections: [...new Set(requestedSections)] as DependencyUpgradeRecipeConfiguration['sections'],
  }
}

export function validationKinds(value: unknown): ImpactValidationKind[] {
  const allowed: ImpactValidationKind[] = ['test', 'typecheck', 'lint', 'build', 'integration', 'end_to_end', 'check']
  if (!Array.isArray(value) || !value.length || value.length > allowed.length) throw new Error('Validation kinds must be a non-empty array')
  const result = [...new Set(value.map(String))]
  if (result.some((kind) => !allowed.includes(kind as ImpactValidationKind))) throw new Error('Validation kind is invalid')
  return result as ImpactValidationKind[]
}

export async function predictDependencyChange(input: {
  repository: { fullName: string; localPath: string }
  revision: string
  configuration: MigrationRecipeConfiguration
  run: ImpactCommandRunner
  signal?: AbortSignal
  maximumLogBytes: number
}): Promise<{ applicable: boolean; reason: string; changes: MigrationPredictedChange[]; log: string }> {
  const { repository, revision, configuration, run, signal, maximumLogBytes } = input
  let raw: string
  try {
    raw = await run('git', ['-C', repository.localPath, 'show', `${revision}:package.json`], {
      signal,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
    })
  } catch {
    return { applicable: false, reason: 'No root package.json exists at the frozen revision', changes: [], log: 'Not applicable' }
  }
  const manifest = JSON.parse(raw) as Record<string, unknown>
  for (const section of configuration.sections) {
    const dependencies = manifest[section]
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
    const current = (dependencies as Record<string, unknown>)[configuration.packageName]
    if (typeof current !== 'string') continue
    if (current === configuration.targetVersion) {
      return {
        applicable: false,
        reason: `${configuration.packageName} already uses ${configuration.targetVersion}`,
        changes: [],
        log: 'Already current',
      }
    }
    const change = {
      path: 'package.json',
      summary: `Update ${configuration.packageName} in ${section}`,
      before: current,
      after: configuration.targetVersion,
    }
    const dryRunLog = await dryRunDependencyChange({
      repository,
      revision,
      section,
      packageName: configuration.packageName,
      change,
      run,
      signal,
      maximumLogBytes,
    })
    return {
      applicable: true,
      reason: `${configuration.packageName} uses ${current} in ${section}`,
      changes: [change],
      log: `Predicted ${change.summary}: ${current} -> ${configuration.targetVersion}\n\nDisposable-worktree dry run:\n${dryRunLog}`,
    }
  }
  return {
    applicable: false,
    reason: `${configuration.packageName} is not declared in the configured dependency sections`,
    changes: [],
    log: 'Not applicable',
  }
}

async function dryRunDependencyChange(input: {
  repository: { fullName: string; localPath: string }
  revision: string
  section: DependencyUpgradeRecipeConfiguration['sections'][number]
  packageName: string
  change: MigrationPredictedChange
  run: ImpactCommandRunner
  signal?: AbortSignal
  maximumLogBytes: number
}): Promise<string> {
  const { repository, revision, section, packageName, change, run, signal, maximumLogBytes } = input
  const workspace = await mkdtemp(join(tmpdir(), 'vertexade-migration-dry-run-'))
  let worktreeAdded = false
  try {
    await run('git', ['-C', repository.localPath, 'worktree', 'add', '--detach', workspace, revision], {
      signal,
      timeoutMs: 60_000,
      maxOutputBytes: 1_000_000,
    })
    worktreeAdded = true
    const resolvedWorkspace = await realpath(workspace)
    const manifestPath = await realpath(resolve(resolvedWorkspace, change.path))
    if (!isWithin(resolvedWorkspace, manifestPath)) throw new Error('Dry-run manifest escapes the disposable worktree')
    const source = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(source) as Record<string, unknown>
    const dependencies = manifest[section]
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error(`Dry-run dependency section ${section} is unavailable`)
    }
    const dependencyRecord = dependencies as Record<string, unknown>
    if (dependencyRecord[packageName] !== change.before) throw new Error('Dry-run dependency entry no longer matches the prediction')
    dependencyRecord[packageName] = change.after
    const indentation = source.match(/\n(\s+)"/)?.[1]?.length || 2
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, indentation)}${source.endsWith('\n') ? '\n' : ''}`, 'utf8')
    const diff = await run('git', ['-C', resolvedWorkspace, 'diff', '--', change.path], {
      signal,
      timeoutMs: 30_000,
      maxOutputBytes: maximumLogBytes,
    })
    if (!diff.trim()) throw new Error('Disposable-worktree dry run produced no diff')
    const changedPaths = await run('git', ['-C', resolvedWorkspace, 'diff', '--name-only'], {
      signal,
      timeoutMs: 30_000,
      maxOutputBytes: 100_000,
    })
    if (changedPaths.trim() !== change.path) throw new Error('Disposable-worktree dry run changed an unexpected file set')
    return diff.slice(0, maximumLogBytes)
  } finally {
    if (worktreeAdded) {
      await run('git', ['-C', repository.localPath, 'worktree', 'remove', '--force', workspace], {
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      }).catch(() => undefined)
    }
    await rm(workspace, { recursive: true, force: true })
  }
}
