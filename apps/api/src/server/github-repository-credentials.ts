import { eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { jobs, repositories } from './database/schema/tables.ts'
import type { SettingsStore } from './settings/settings-store.ts'

export type GitHubRepositoryCredentials = { token?: string; sshKeyPath?: string }

export function createGitHubRepositoryCredentialResolver(settings: SettingsStore) {
  return (repository: string): GitHubRepositoryCredentials => {
    const config = settings.read<{
      accounts?: Array<{ repositories?: string[]; token?: string; sshKeyPath?: string }>
    }>('extension:github:config', {})
    const normalized = repository.trim().toLowerCase()
    const account = config.accounts?.find((candidate) => candidate.repositories?.some((name) => String(name).toLowerCase() === normalized))
    return { token: account?.token, sshKeyPath: account?.sshKeyPath }
  }
}

function sshCommand(keyPath: string) {
  return `ssh -i '${keyPath.replaceAll("'", "'\\''")}' -o IdentitiesOnly=yes`
}

export function repositoryCredentialEnvironment(
  database: DrizzleDashboardDatabase,
  resolveCredentials: (repository: string) => GitHubRepositoryCredentials,
  cwd: string,
  jobId?: number,
) {
  const byJob = jobId
    ? database
        .select({ fullName: repositories.fullName, localPath: repositories.localPath })
        .from(jobs)
        .innerJoin(repositories, eq(repositories.id, jobs.repoId))
        .where(eq(jobs.id, jobId))
        .get()
    : undefined
  const repository =
    byJob ||
    database
      .select({ fullName: repositories.fullName, localPath: repositories.localPath })
      .from(repositories)
      .all()
      .filter(({ localPath }) => cwd === localPath || cwd.startsWith(`${localPath}/`))
      .sort((left, right) => right.localPath.length - left.localPath.length)[0]
  if (!repository) return {}
  const credentials = resolveCredentials(repository.fullName)
  return {
    ...(credentials.token ? { GH_TOKEN: credentials.token } : {}),
    ...(credentials.sshKeyPath ? { GIT_SSH_COMMAND: sshCommand(credentials.sshKeyPath) } : {}),
  }
}
