import { describe, expect, it } from 'vite-plus/test'
import { PlatformProviderRegistries } from './provider-registry.ts'

const scm = {
  id: 'github',
  name: 'GitHub',
  parseRepository: () => ({
    id: 'acme/app',
    webUrl: 'https://github.com/acme/app',
    cloneUrl: 'git@github.com:acme/app.git',
  }),
  currentUser: async () => ({ login: 'octocat' }),
  listPullRequests: async () => [],
  listOpenPullRequests: async () => [],
  pullRequestStatus: async () => [],
  pullRequestDetails: async () => ({}),
  pullRequestDiff: async () => '',
  reviewThreads: async () => ({}),
  listLabels: async () => [],
  listCollaborators: async () => [],
  addLabel: async () => [],
  removeLabel: async () => [],
  requestReviewers: async () => ({}),
  approve: async () => {},
  enableAutoMerge: async () => {},
  updateBranch: async () => ({}),
  markReady: async () => {},
  postReviewComment: async () => {},
  postReviewSuggestions: async () => ({}),
}

describe('platform provider registries', () => {
  it('binds providers to modules and respects module enablement', () => {
    const enabled = new Set(['github'])
    const providers = new PlatformProviderRegistries((moduleId) => enabled.has(moduleId))
    providers.forModule('github').scm.register(scm)
    expect(providers.scm.require('github').moduleId).toBe('github')
    enabled.clear()
    expect(() => providers.scm.require('github')).toThrow('github module is disabled')
  })

  it('rejects duplicate providers of the same kind', () => {
    const providers = new PlatformProviderRegistries()
    providers.forModule('github').scm.register(scm)
    expect(() => providers.forModule('other').scm.register(scm)).toThrow('scm provider already registered: github')
  })

  it('registers extension-defined provider kinds without platform changes', () => {
    const providers = new PlatformProviderRegistries()
    const incidents = { id: 'pager', name: 'Pager', listIncidents: async () => [] }
    providers.forModule('pager').register('incident-management', incidents)

    expect(providers.forKind<typeof incidents>('incident-management').require('pager')).toMatchObject({
      id: 'pager',
      name: 'Pager',
      moduleId: 'pager',
    })
    expect(providers.declarations('pager')).toEqual(['incident-management:pager'])
    expect(providers.capabilities()).toContainEqual({
      id: 'pager',
      name: 'Pager',
      kind: 'incident-management',
      moduleId: 'pager',
      enabled: true,
    })
  })

  it('lists only enabled Work reference providers for the shared picker', () => {
    const enabled = new Set(['linear'])
    const providers = new PlatformProviderRegistries((moduleId) => enabled.has(moduleId))
    providers.forModule('linear').workReferences.register({ id: 'linear', name: 'Linear', references: async () => [] })
    providers.forModule('airtable').workReferences.register({ id: 'airtable', name: 'Airtable', references: async () => [] })
    expect(providers.workReferences.available().map((provider) => provider.id)).toEqual(['linear'])
  })
})
