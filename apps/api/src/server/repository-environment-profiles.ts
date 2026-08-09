import { lstat } from 'node:fs/promises'
import { posix, relative, resolve, sep } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { repositories, repositoryEnvironmentProfilePaths, repositoryEnvironmentProfiles } from './database/schema/tables.ts'
import type { SettingsStore } from './settings/settings-store.ts'
import {
  inspectRepositoryEnvironmentEntries,
  normalizeRepositoryEnvironmentPaths,
  snapshotRepositoryEnvironment,
  type RepositoryEnvironmentEntry,
} from './repository-environment.ts'

type Repository = {
  id: number
  full_name: string
  local_path: string
}

type Run = (command: string, args: string[], options?: Record<string, unknown>) => Promise<string>

type StoredProfile = {
  id: number
  scopePath: string
  startCommand: string | null
  stopCommand: string | null
}

type ProfileSecrets = {
  variables: Record<string, string>
  envFiles: Record<string, string>
}

type RepositorySecrets = Record<string, ProfileSecrets>

type InputSecret = {
  name?: unknown
  path?: unknown
  value?: unknown
  content?: unknown
}

type InputProfile = {
  scope?: unknown
  snapshotPaths?: unknown
  variables?: unknown
  envFiles?: unknown
  startCommand?: unknown
  stopCommand?: unknown
}

type NormalizedProfile = {
  scope: string
  snapshotPaths: Array<{ path: string; kind: RepositoryEnvironmentEntry['kind'] }>
  startCommand: string
  stopCommand: string
}

export type RepositoryEnvironmentProfile = {
  scope: string
  snapshotPaths: Array<{ path: string; kind: RepositoryEnvironmentEntry['kind'] }>
  variables: Array<{ name: string; configured: true }>
  envFiles: Array<{ path: string; configured: true }>
  startCommand: string
  stopCommand: string
  inheritsFrom: string[]
}

export type ResolvedRepositoryEnvironment = {
  repository: string
  scope: string
  variables: Record<string, string>
  startCommand: string
  stopCommand: string
}

const maximumProfiles = 30
const maximumVariables = 100
const maximumEnvFiles = 20
const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function secretsKey(repositoryId: number) {
  return `repository_environment:${repositoryId}`
}

function profileDepth(scope: string) {
  return scope ? scope.split('/').length : 0
}

function profileApplies(scope: string, target: string) {
  return !scope || target === scope || target.startsWith(`${scope}/`)
}

function normalizedRelativePath(value: unknown, label: string, allowRoot = false) {
  const raw = String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
  if (!raw && allowRoot) return ''
  if (!raw || invalidPathCharacters(raw)) {
    throw new Error(`${label} must be a normalized repository-relative path`)
  }
  if (invalidPathSegments(raw) || forbiddenGitPath(raw)) {
    throw new Error(`${label} must be a normalized repository-relative path outside .git`)
  }
  return raw
}

function invalidPathCharacters(path: string) {
  return path.length > 500 || path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)
}

function invalidPathSegments(path: string) {
  return path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
}

function forbiddenGitPath(path: string) {
  return path === '.git' || path.startsWith('.git/')
}

function scopedPath(scope: string, path: string) {
  return scope ? posix.join(scope, path) : path
}

function command(value: unknown, label: string) {
  const result = String(value ?? '').trim()
  if (result.length > 4_000 || /[\u0000]/.test(result)) throw new Error(`${label} must contain at most 4,000 characters`)
  return result
}

function array(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function unique<T>(values: T[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
  return values
}

function environmentVariableName(value: unknown) {
  const name = String(value ?? '').trim()
  if (!variableNamePattern.test(name)) throw new Error(`Invalid environment variable name: ${name || '(empty)'}`)
  return name
}

function profileSecretInput(input: InputProfile, previous: ProfileSecrets): ProfileSecrets {
  const variables = array(input.variables ?? [], 'Environment variables')
  if (variables.length > maximumVariables) throw new Error(`A profile can have at most ${maximumVariables} environment variables`)
  const variableNames = unique(
    variables.map((entry: InputSecret) => environmentVariableName(entry?.name)),
    'Environment variable names',
  )
  const nextVariables = Object.fromEntries(
    variableNames.map((name, index) => {
      const entry = variables[index] as InputSecret
      if (Object.hasOwn(entry, 'value')) return [name, String(entry.value ?? '')]
      if (Object.hasOwn(previous.variables, name)) return [name, previous.variables[name]]
      throw new Error(`Enter a value for new environment variable ${name}`)
    }),
  )

  const envFiles = array(input.envFiles ?? [], 'Managed .env files')
  if (envFiles.length > maximumEnvFiles) throw new Error(`A profile can have at most ${maximumEnvFiles} managed .env files`)
  const envPaths = unique(
    envFiles.map((entry: InputSecret) => normalizedRelativePath(entry?.path, 'Managed .env path')),
    'Managed .env paths',
  )
  const nextEnvFiles = Object.fromEntries(
    envPaths.map((path, index) => {
      const entry = envFiles[index] as InputSecret
      if (Object.hasOwn(entry, 'content')) return [path, String(entry.content ?? '')]
      if (Object.hasOwn(previous.envFiles, path)) return [path, previous.envFiles[path]]
      throw new Error(`Enter content for new managed .env file ${path}`)
    }),
  )
  return { variables: nextVariables, envFiles: nextEnvFiles }
}

function dotenvValue(raw: string) {
  const value = raw.trim()
  if (!value) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1)
    return value.startsWith('"') ? inner.replaceAll('\\n', '\n').replaceAll('\\"', '"') : inner
  }
  return value.replace(/\s+#.*$/, '').trimEnd()
}

export function parseManagedEnv(content: string) {
  const environment: Record<string, string> = {}
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const candidate = line.trim()
    if (!candidate || candidate.startsWith('#')) continue
    const match = candidate.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!match) throw new Error(`Invalid managed .env entry on line ${index + 1}`)
    environment[match[1]] = dotenvValue(match[2])
  }
  return environment
}

function environmentRows(database: DrizzleDashboardDatabase, profileId: number) {
  return database
    .select({ path: repositoryEnvironmentProfilePaths.relativePath, kind: repositoryEnvironmentProfilePaths.entryKind })
    .from(repositoryEnvironmentProfilePaths)
    .where(eq(repositoryEnvironmentProfilePaths.profileId, profileId))
    .orderBy(sql`${repositoryEnvironmentProfilePaths.relativePath} COLLATE NOCASE`)
    .all() as Array<{ path: string; kind: RepositoryEnvironmentEntry['kind'] }>
}

function inheritedScopes(profiles: StoredProfile[], scope: string) {
  return profiles
    .filter((profile) => profile.scopePath !== scope && profileApplies(profile.scopePath, scope))
    .sort((left, right) => profileDepth(left.scopePath) - profileDepth(right.scopePath))
    .map((profile) => profile.scopePath)
}

function applicableProfiles(profiles: StoredProfile[], target: string) {
  return profiles
    .filter((profile) => profileApplies(profile.scopePath, target))
    .sort((left, right) => profileDepth(left.scopePath) - profileDepth(right.scopePath))
}

function mergedEnvironment(profiles: StoredProfile[], secrets: RepositorySecrets) {
  const environment: Record<string, string> = {}
  for (const profile of profiles) {
    const secret = secrets[profile.scopePath]
    for (const content of Object.values(secret?.envFiles || {})) Object.assign(environment, parseManagedEnv(content))
    Object.assign(environment, secret?.variables || {})
  }
  return environment
}

function inheritedCommand(profiles: StoredProfile[], key: 'startCommand' | 'stopCommand') {
  return [...profiles].reverse().find((profile) => Boolean(profile[key]))?.[key] || ''
}

export class RepositoryEnvironmentProfileService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly settings: SettingsStore,
    private readonly run: Run,
  ) {}

  private storedProfiles(repositoryId: number): StoredProfile[] {
    return this.database
      .select({
        id: repositoryEnvironmentProfiles.id,
        scopePath: repositoryEnvironmentProfiles.scopePath,
        startCommand: repositoryEnvironmentProfiles.startCommand,
        stopCommand: repositoryEnvironmentProfiles.stopCommand,
      })
      .from(repositoryEnvironmentProfiles)
      .where(eq(repositoryEnvironmentProfiles.repositoryId, repositoryId))
      .orderBy(
        sql`CASE WHEN ${repositoryEnvironmentProfiles.scopePath} = '' THEN 0 ELSE 1 END`,
        sql`${repositoryEnvironmentProfiles.scopePath} COLLATE NOCASE`,
      )
      .all()
  }

  private secrets(repositoryId: number) {
    return this.settings.read<RepositorySecrets>(secretsKey(repositoryId), {})
  }

  list(repositoryId: number): RepositoryEnvironmentProfile[] {
    const profiles = this.storedProfiles(repositoryId)
    const secrets = this.secrets(repositoryId)
    return profiles.map((profile) => {
      const secret = secrets[profile.scopePath] || { variables: {}, envFiles: {} }
      return {
        scope: profile.scopePath,
        snapshotPaths: environmentRows(this.database, profile.id),
        variables: Object.keys(secret.variables)
          .sort()
          .map((name) => ({ name, configured: true as const })),
        envFiles: Object.keys(secret.envFiles)
          .sort()
          .map((path) => ({ path, configured: true as const })),
        startCommand: profile.startCommand || '',
        stopCommand: profile.stopCommand || '',
        inheritsFrom: inheritedScopes(profiles, profile.scopePath),
      }
    })
  }

  private async validateScope(repository: Repository, value: unknown) {
    const scope = normalizedRelativePath(value, 'Profile scope', true)
    if (!scope) return scope
    const path = resolve(repository.local_path, scope)
    const relation = relative(resolve(repository.local_path), path)
    if (relation.startsWith(`..${sep}`) || relation === '..') throw new Error(`Profile scope escapes the repository: ${scope}`)
    try {
      const details = await lstat(path)
      if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('scope must be a regular directory')
    } catch (error) {
      throw new Error(`Cannot use profile scope ${scope}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return scope
  }

  private async normalizeProfile(
    repository: Repository,
    profile: InputProfile,
    scope: string,
    previousSecrets: RepositorySecrets,
    nextSecrets: RepositorySecrets,
  ): Promise<NormalizedProfile> {
    const paths = unique(
      array(profile.snapshotPaths ?? [], 'Snapshot paths').map((entry: unknown) =>
        normalizedRelativePath(typeof entry === 'object' && entry !== null && 'path' in entry ? entry.path : entry, 'Snapshot path'),
      ),
      'Snapshot paths',
    )
    const inspected = await inspectRepositoryEnvironmentEntries(
      repository.local_path,
      paths.map((path) => scopedPath(scope, path)),
    )
    nextSecrets[scope] = profileSecretInput(profile, previousSecrets[scope] || { variables: {}, envFiles: {} })
    return {
      scope,
      snapshotPaths: paths.map((path, index) => ({ path, kind: inspected[index].kind })),
      startCommand: command(profile.startCommand, 'Start command'),
      stopCommand: command(profile.stopCommand, 'Stop command'),
    }
  }

  private persist(repositoryId: number, profiles: NormalizedProfile[], secrets: RepositorySecrets) {
    this.database.transaction((transaction) => {
      transaction.delete(repositoryEnvironmentProfiles).where(eq(repositoryEnvironmentProfiles.repositoryId, repositoryId)).run()
      for (const profile of profiles) {
        const result = transaction
          .insert(repositoryEnvironmentProfiles)
          .values({
            repositoryId,
            scopePath: profile.scope,
            startCommand: profile.startCommand || null,
            stopCommand: profile.stopCommand || null,
          })
          .run()
        if (profile.snapshotPaths.length) {
          transaction
            .insert(repositoryEnvironmentProfilePaths)
            .values(
              profile.snapshotPaths.map((entry) => ({
                profileId: Number(result.lastInsertRowid),
                relativePath: entry.path,
                entryKind: entry.kind,
              })),
            )
            .run()
        }
      }
      if (Object.values(secrets).some((secret) => Object.keys(secret.variables).length || Object.keys(secret.envFiles).length)) {
        this.settings.write(secretsKey(repositoryId), secrets)
      } else {
        this.settings.delete(secretsKey(repositoryId))
      }
    })
  }

  async replace(repository: Repository, value: unknown) {
    const input = array(value, 'Environment profiles') as InputProfile[]
    if (input.length > maximumProfiles) throw new Error(`A repository can have at most ${maximumProfiles} environment profiles`)
    const scopes = await Promise.all(input.map((profile) => this.validateScope(repository, profile?.scope)))
    unique(scopes, 'Environment profile scopes')

    const previousSecrets = this.secrets(repository.id)
    const nextSecrets: RepositorySecrets = {}
    const normalized = await Promise.all(
      input.map((profile, index) => this.normalizeProfile(repository, profile, scopes[index], previousSecrets, nextSecrets)),
    )

    const allSnapshotPaths = normalized.flatMap((profile) => profile.snapshotPaths.map(({ path }) => scopedPath(profile.scope, path)))
    normalizeRepositoryEnvironmentPaths(allSnapshotPaths)
    for (const path of allSnapshotPaths) {
      const tracked = String(await this.run('git', ['-C', repository.local_path, 'ls-files', '--', path])).trim()
      if (tracked) throw new Error(`${path} is tracked by Git and already appears in every worktree`)
    }
    this.persist(repository.id, normalized, nextSecrets)
    return this.list(repository.id)
  }

  snapshotEntries(repositoryId: number): RepositoryEnvironmentEntry[] {
    return this.storedProfiles(repositoryId).flatMap((profile) =>
      environmentRows(this.database, profile.id).map((entry) => ({
        relativePath: scopedPath(profile.scopePath, entry.path),
        kind: entry.kind,
      })),
    )
  }

  async prepareWorktree(repository: Repository, worktree: string) {
    await snapshotRepositoryEnvironment(repository.local_path, worktree, this.snapshotEntries(repository.id))
  }

  resolve(repositoryId: number, targetPath: string): ResolvedRepositoryEnvironment {
    const target = normalizedRelativePath(targetPath, 'Preview service path', true)
    const profiles = applicableProfiles(this.storedProfiles(repositoryId), target)
    const secrets = this.secrets(repositoryId)
    const repository = this.database
      .select({ fullName: repositories.fullName })
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .get()
    return {
      repository: repository?.fullName || '',
      scope: profiles.at(-1)?.scopePath || '',
      variables: mergedEnvironment(profiles, secrets),
      startCommand: inheritedCommand(profiles, 'startCommand'),
      stopCommand: inheritedCommand(profiles, 'stopCommand'),
    }
  }
}
