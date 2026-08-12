import { access, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'

export type GitHubTokenAccount = {
  id: string
  label: string
  token: string
  repositories: string[]
  sshKeyPath: string
}

const accountIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/
const repositoryPattern = /^[\w.-]+\/[\w.-]+$/

function repository(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .toLowerCase()
}

function validateIdentity(id: string, label: string) {
  if (!accountIdPattern.test(id)) throw new Error(`Invalid GitHub account id: ${id || '(empty)'}`)
  if (!label || label.length > 100) throw new Error(`GitHub account ${id} requires a label of at most 100 characters`)
}

function validateToken(id: string, token: string) {
  if (!token || token.length > 1_000 || /[\u0000-\u001f\u007f]/.test(token)) throw new Error(`GitHub account ${id} has an invalid token`)
}

function validateSshKeyPath(id: string, path: string) {
  if (path && (!path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)))
    throw new Error(`GitHub account ${id} SSH key path must be absolute`)
}

function normalizedRepositories(id: string, input: unknown) {
  if (!Array.isArray(input)) throw new Error(`GitHub account ${id} repositories must be an array`)
  const repositories = input.map(repository)
  if (repositories.some((entry) => !repositoryPattern.test(entry))) throw new Error(`GitHub account ${id} has an invalid repository`)
  if (new Set(repositories).size !== repositories.length) throw new Error(`GitHub account ${id} repositories must be unique`)
  return repositories
}

function normalizeAccount(raw: unknown, existing: ReadonlyMap<string, GitHubTokenAccount>): GitHubTokenAccount {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const id = String(value.id ?? '')
    .trim()
    .toLowerCase()
  const label = String(value.label ?? '').trim()
  const token = String(value.token ?? '').trim() || existing.get(id)?.token || ''
  const sshKeyPath = String(value.ssh_key_path ?? value.sshKeyPath ?? '').trim()
  validateIdentity(id, label)
  validateToken(id, token)
  validateSshKeyPath(id, sshKeyPath)
  const repositories = normalizedRepositories(id, value.repositories)
  return { id, label, token, repositories, sshKeyPath }
}

function validateUniqueAssignments(accounts: GitHubTokenAccount[]) {
  if (new Set(accounts.map(({ id }) => id)).size !== accounts.length) throw new Error('GitHub account ids must be unique')
  const assigned = accounts.flatMap((account) => account.repositories.map((name) => [name, account.id] as const))
  const duplicate = assigned.find(([name], index) => assigned.findIndex(([candidate]) => candidate === name) !== index)
  if (duplicate) throw new Error(`Repository ${duplicate[0]} is assigned to multiple GitHub accounts`)
}

export function normalizeGitHubTokenAccounts(input: unknown, current: GitHubTokenAccount[] = []): GitHubTokenAccount[] {
  if (!Array.isArray(input)) throw new Error('GitHub accounts must be an array')
  if (input.length > 20) throw new Error('At most 20 GitHub accounts can be configured')
  const existing = new Map(current.map((account) => [account.id, account]))
  const accounts = input.map((raw) => normalizeAccount(raw, existing))
  validateUniqueAssignments(accounts)
  return accounts
}

export async function validateGitHubSshKeyPaths(accounts: GitHubTokenAccount[]) {
  for (const account of accounts) {
    if (!account.sshKeyPath) continue
    const info = await lstat(account.sshKeyPath).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`SSH key for GitHub account ${account.id} must be a regular file`)
    await access(account.sshKeyPath, constants.R_OK)
  }
}

export function accountForRepository(accounts: GitHubTokenAccount[], repositoryName: string) {
  const name = repository(repositoryName)
  return accounts.find((account) => account.repositories.includes(name)) || null
}

export function publicGitHubTokenAccounts(accounts: GitHubTokenAccount[]) {
  return accounts.map(({ token, sshKeyPath, ...account }) => ({
    ...account,
    ssh_key_path: sshKeyPath,
    has_token: Boolean(token),
  }))
}

export function sshCommand(keyPath: string) {
  const escaped = keyPath.replaceAll("'", "'\\''")
  return `ssh -i '${escaped}' -o IdentitiesOnly=yes`
}
