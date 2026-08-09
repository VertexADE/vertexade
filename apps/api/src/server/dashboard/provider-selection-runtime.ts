import { and, desc, eq, or } from 'drizzle-orm'
import { selectContextualProvider } from '../platform/provider-selection.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { repositories, workResources } from '../database/schema/tables.ts'
import type { EncryptedSettingsStore } from '../settings/settings-store.ts'

export function createProviderSelectionRuntime({
  database,
  extensions,
  settings,
  state,
}: {
  database: DrizzleDashboardDatabase
  extensions: any
  settings: EncryptedSettingsStore
  state?: { states(): Record<string, boolean>; enabled(id: string): boolean }
}) {
  function extensionStates() {
    if (state) return state.states()
    const defaults = Object.fromEntries(extensions.installed().map(({ extension }: any) => [extension.manifest.id, true]))
    const persisted = settings.read<Record<string, boolean>>('extensions', {})
    const states = { ...defaults, ...persisted }
    if (!settings.has('extensions') || Object.keys(defaults).some((id) => !Object.hasOwn(persisted, id)))
      settings.write('extensions', states)
    return states
  }

  function selectedProviderId(kind: string, { repository = '', explicit = '' } = {}) {
    const hints = [repository]
    let inferred = ''
    if (repository) {
      const stored = database
        .select({ id: repositories.id, cloneUrl: repositories.cloneUrl })
        .from(repositories)
        .where(or(eq(repositories.fullName, repository), eq(repositories.cloneUrl, repository)))
        .limit(1)
        .get()
      if (stored) {
        hints.push(stored.cloneUrl || '')
        const resourceKind = kind === 'scm' ? 'repository' : kind === 'deployment' ? 'deployment' : ''
        if (resourceKind)
          inferred =
            database
              .select({ provider: workResources.provider })
              .from(workResources)
              .where(andRepositoryKind(stored.id, resourceKind))
              .orderBy(desc(workResources.updatedAt), desc(workResources.id))
              .limit(1)
              .get()?.provider || ''
      }
    }
    const providers = extensions.providers.capabilities()
    const registered = inferred && providers.some((provider: any) => provider.kind === kind && provider.id === inferred && provider.enabled)
    const requested = explicit || (registered ? inferred : '')
    return selectContextualProvider(providers, kind, requested ? { explicit: requested, hints } : { hints })
  }

  function extensionEnabled(id: string) {
    if (state) return state.enabled(id)
    const value = extensionStates()[id]
    return typeof value === 'boolean' ? value : Boolean(extensions.installed(id)?.enabled)
  }

  function scmProvider(repository = '', explicit = '') {
    return extensions.providers.scm.require(selectedProviderId('scm', { repository, explicit }))
  }

  return { extensionStates, selectedProviderId, extensionEnabled, scmProvider }
}

function andRepositoryKind(repositoryId: number, kind: string) {
  return and(eq(workResources.repositoryId, repositoryId), eq(workResources.kind, kind))
}
