import type { DashboardExtension } from '@vertexade/platform-contracts'
import { createCacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import { createGitHubAuthenticationLifecycle } from './authentication-lifecycle.ts'
import { createGitHubDeploymentProvider } from './deployments.ts'
import { createGitHubManifest } from './manifest.ts'
import { createGitHubScmProvider } from './provider.ts'
import { registerGitHubReviewActions } from './review-actions.ts'
import { registerGitHubSettingsRoutes } from './settings-routes.ts'
import { normalizeGitHubDeploymentTargets } from './deployment-configuration.ts'
import type { GitHubContext } from './types.ts'
import { accountForRepository, normalizeGitHubTokenAccounts } from './account-configuration.ts'

export function createExtension(context: GitHubContext): DashboardExtension {
  const accounts = () => {
    const stored = context.host.settings.read<{ accounts?: unknown }>('config', {})
    return normalizeGitHubTokenAccounts(stored.accounts ?? [], [])
  }
  const scm = createGitHubScmProvider(
    context.run,
    (repository) => accountForRepository(accounts(), repository)?.token,
    () => accounts().map((account) => account.token),
  )
  const authentication = createGitHubAuthenticationLifecycle(context, scm)
  const refreshTrigger = createGitHubDeploymentsRefreshTrigger()

  return {
    manifest: createGitHubManifest(refreshTrigger.capability),
    status: authentication.status,
    initialize: authentication.initialize,
    dispose: authentication.dispose,
    register({ providers, routes, triggers, actions }) {
      providers.scm.register(scm)
      providers.deployment.register(
        createGitHubDeploymentProvider(
          context.run,
          context.host.cache,
          refreshTrigger,
          () => {
            const stored = context.host.settings.read<{ deploymentTargets?: unknown }>('config', {})
            return normalizeGitHubDeploymentTargets(stored.deploymentTargets)
          },
          (repository) => accountForRepository(accounts(), repository)?.token,
        ),
      )
      triggers.register(refreshTrigger.capability)
      registerGitHubReviewActions(actions, scm, context)
      registerGitHubSettingsRoutes(routes, authentication, context)
    },
  }
}

function createGitHubDeploymentsRefreshTrigger() {
  return createCacheRefreshTrigger({
    id: 'github.deployments-refreshed',
    name: 'GitHub deployments refreshed',
    description: 'When GitHub Actions deployment data is fetched from the upstream service.',
    resource: 'deployments',
    properties: {
      count: { type: 'integer', title: 'Service count', minimum: 0 },
      repository: { type: 'string', title: 'Repository' },
    },
  })
}
