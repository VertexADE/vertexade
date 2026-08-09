import type { ExtensionRegistrationContext } from '@vertexade/platform-contracts'
import { readJsonObject } from '@vertexade/platform-server/http'
import { createGitHubInstallationToken, type GitHubAppCredentials, type GitHubInstallationToken } from './auth.ts'
import type { GitHubAuthenticationLifecycle } from './authentication-lifecycle.ts'
import type { GitHubContext } from './types.ts'

type GitHubAppConfig = GitHubAppCredentials & { active: boolean }

export function registerGitHubSettingsRoutes(
  routes: ExtensionRegistrationContext['routes'],
  authentication: GitHubAuthenticationLifecycle,
  context: GitHubContext,
) {
  routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () => Response.json(settingsResponse(authentication.config(), authentication)),
  })
  routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    handler: (request) => saveGitHubSettings(request, authentication, context),
  })
  routes.register({
    method: 'DELETE',
    path: '/settings',
    availability: 'installed',
    handler: () => deleteGitHubSettings(authentication, context),
  })
}

async function saveGitHubSettings(request: Request, authentication: GitHubAuthenticationLifecycle, context: GitHubContext) {
  const input = await readJsonObject(request)
  const value = settingsInput(input, authentication.config())
  const invalid = invalidActiveCredentials(value)
  if (invalid) return Response.json({ error: invalid }, { status: 400 })
  const exchange = await exchangeInstallationToken(value, context.fetch)
  if (exchange.error) return Response.json({ error: exchange.error }, { status: 400 })

  context.host.settings.write('config', value)
  context.host.cache?.invalidate()
  applySavedAuthentication(value, exchange.token, authentication)
  context.host.cache?.invalidate()
  context.host.events.emit('scm_auth_updated')
  return Response.json(settingsResponse(value, authentication))
}

function deleteGitHubSettings(authentication: GitHubAuthenticationLifecycle, context: GitHubContext) {
  context.host.settings.delete('config')
  context.host.cache?.invalidate()
  authentication.restore()
  context.host.events.emit('scm_auth_deleted')
  return Response.json({ active: false, ...authentication.state() })
}

function settingsInput(input: Record<string, unknown>, current: GitHubAppConfig): GitHubAppConfig {
  return {
    active: Boolean(input.active),
    appId: String(input.app_id || '').trim(),
    installationId: String(input.installation_id || '').trim(),
    privateKey: String(input.private_key || '').trim() || current.privateKey,
  }
}

function invalidActiveCredentials(value: GitHubAppConfig) {
  if (!value.active) return ''
  if (!/^\d+$/.test(value.appId)) return invalidCredentialsMessage
  if (!/^\d+$/.test(value.installationId)) return invalidCredentialsMessage
  if (!value.privateKey.includes('PRIVATE KEY')) return invalidCredentialsMessage
  return ''
}

const invalidCredentialsMessage = 'Active GitHub App authentication requires numeric App and installation IDs plus a PEM private key'

async function exchangeInstallationToken(
  value: GitHubAppConfig,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<{ token: GitHubInstallationToken | null; error: string }> {
  if (!value.active) return { token: null, error: '' }
  try {
    return { token: await createGitHubInstallationToken(value, fetchImpl), error: '' }
  } catch (error) {
    return { token: null, error: error instanceof Error ? error.message : 'GitHub App authentication failed' }
  }
}

function applySavedAuthentication(
  value: GitHubAppConfig,
  token: GitHubInstallationToken | null,
  authentication: GitHubAuthenticationLifecycle,
) {
  if (value.active && token) authentication.setToken('github-app', token.token, token.expiresAt)
  else authentication.restore()
}

function settingsResponse(value: GitHubAppConfig, authentication: GitHubAuthenticationLifecycle) {
  return {
    active: Boolean(value.active),
    app_id: value.appId || '',
    installation_id: value.installationId || '',
    has_private_key: Boolean(value.privateKey),
    ...authentication.state(),
  }
}
