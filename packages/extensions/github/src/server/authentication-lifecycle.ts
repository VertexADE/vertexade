import type { ScmAuthenticationState, ScmProvider } from '@vertexade/platform-contracts'
import { createGitHubInstallationToken, type GitHubAppCredentials } from './auth.ts'
import type { GitHubContext } from './types.ts'

const defaultCredentials: GitHubAppCredentials & { active: boolean } = {
  active: false,
  appId: '',
  installationId: '',
  privateKey: '',
}

export type GitHubAuthenticationLifecycle = ReturnType<typeof createGitHubAuthenticationLifecycle>

export function createGitHubAuthenticationLifecycle(context: GitHubContext, scm: ScmProvider) {
  const originalToken = process.env.GH_TOKEN
  let authentication = originalAuthentication(originalToken)
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  let controller: AbortController | undefined
  let refreshPromise: Promise<void> | undefined

  const config = () => context.host.settings.read('config', defaultCredentials)
  const restore = () => {
    restoreProcessToken(originalToken)
    authentication = originalAuthentication(originalToken)
  }
  const setToken = (source: string, token: string, expiresAt: string | null) => {
    process.env.GH_TOKEN = token
    authentication = { source, connected: true, error: '', expiresAt }
  }
  const fail = (source: string, error: unknown) => {
    process.env.GH_TOKEN = `${source}-authentication-failed`
    authentication = { source, connected: false, error: authenticationError(error), expiresAt: null }
  }
  const markPending = () => {
    process.env.GH_TOKEN = 'github-app-authentication-pending'
    authentication = {
      source: 'github-app',
      connected: false,
      error: 'GitHub App authentication is initializing',
      expiresAt: null,
    }
  }
  const apply = async (signal?: AbortSignal) => {
    const credentials = config()
    if (!credentials.active) {
      restore()
      return
    }
    try {
      const token = await createGitHubInstallationToken(credentials, context.fetch, { signal })
      setToken('github-app', token.token, token.expiresAt)
    } catch (error) {
      if (signal?.aborted !== true) fail('github-app', error)
      throw error
    }
  }
  const refresh = () => {
    if (refreshPromise) return refreshPromise
    refreshPromise = apply(controller?.signal).finally(() => {
      refreshPromise = undefined
    })
    return refreshPromise
  }
  const initialize = async () => {
    controller?.abort()
    controller = new AbortController()
    if (config().active) markPending()
    void refresh().catch(ignoreAuthenticationFailure)
    refreshTimer = setInterval(() => void refresh().catch(ignoreAuthenticationFailure), context.authenticationRefreshMs ?? 5 * 60_000)
    refreshTimer.unref()
  }
  const dispose = () => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = undefined
    controller?.abort()
    controller = undefined
    restore()
  }
  const state = (): ScmAuthenticationState => ({
    ...authentication,
    ...(authentication.source === 'gh-cli' ? { requiredSetupCheckId: 'github-auth' } : {}),
  })
  const status = () => {
    const current = state()
    const connected = Boolean(current.connected)
    return {
      configured: connected,
      healthy: connected,
      message: connected ? undefined : String(current.error || 'GitHub authentication is unavailable'),
    }
  }

  scm.authentication = state
  return { config, state, status, initialize, dispose, refresh, restore, setToken, fail }
}

function originalAuthentication(token: string | undefined): ScmAuthenticationState {
  return { source: token ? 'token' : 'gh-cli', connected: true, error: '', expiresAt: null }
}

function restoreProcessToken(token: string | undefined) {
  if (token) process.env.GH_TOKEN = token
  else delete process.env.GH_TOKEN
}

function authenticationError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function ignoreAuthenticationFailure() {
  return undefined
}
