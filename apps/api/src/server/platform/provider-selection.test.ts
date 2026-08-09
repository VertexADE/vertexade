import { describe, expect, it } from 'vite-plus/test'
import { registeredProviders, selectContextualProvider } from './provider-selection.ts'

const providers = [
  { id: 'gitlab', name: 'GitLab', moduleId: 'gitlab', kind: 'scm', enabled: true },
  { id: 'github', name: 'GitHub', moduleId: 'github', kind: 'scm', enabled: true },
  { id: 'disabled', name: 'Disabled', moduleId: 'disabled', kind: 'scm', enabled: false },
  { id: 'azure-devops', kind: 'work-management', enabled: true },
  { id: 'github-actions', kind: 'deployment', enabled: true },
]

describe('contextual provider selection', () => {
  it('derives aspect registrations directly from extension declarations', () => {
    expect(registeredProviders(providers)).toEqual({
      deployment: ['github-actions'],
      scm: ['gitlab', 'github', 'disabled'],
      'work-management': ['azure-devops'],
    })
  })

  it('selects an enabled registered provider from explicit and repository context', () => {
    expect(selectContextualProvider(providers, 'scm', { explicit: 'gitlab' })).toBe('gitlab')
    expect(
      selectContextualProvider(providers, 'scm', {
        hints: ['https://github.com/example/repo.git'],
      }),
    ).toBe('github')
    expect(
      selectContextualProvider(providers, 'scm', {
        hints: ['https://gitlab.example/example/repo'],
      }),
    ).toBe('gitlab')
  })

  it('never selects unregistered or disabled providers', () => {
    expect(() => selectContextualProvider(providers, 'scm', { explicit: 'disabled' })).toThrow('not an enabled registered')
    expect(() => selectContextualProvider(providers, 'findings')).toThrow('No enabled extension is registered')
  })
})
