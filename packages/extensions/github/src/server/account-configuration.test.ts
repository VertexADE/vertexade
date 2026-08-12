import { describe, expect, it } from 'vite-plus/test'
import { accountForRepository, normalizeGitHubTokenAccounts, publicGitHubTokenAccounts, sshCommand } from './account-configuration.ts'

describe('GitHub token account configuration', () => {
  it('preserves encrypted tokens while updating repository assignments', () => {
    const current = [{ id: 'work', label: 'Work', token: 'secret', repositories: ['acme/old'], sshKeyPath: '/keys/work' }]
    const accounts = normalizeGitHubTokenAccounts(
      [{ id: 'work', label: 'Work account', repositories: ['Acme/New'], ssh_key_path: '/keys/work' }],
      current,
    )
    expect(accounts).toEqual([{ id: 'work', label: 'Work account', token: 'secret', repositories: ['acme/new'], sshKeyPath: '/keys/work' }])
    expect(publicGitHubTokenAccounts(accounts)).toEqual([
      { id: 'work', label: 'Work account', repositories: ['acme/new'], ssh_key_path: '/keys/work', has_token: true },
    ])
    expect(accountForRepository(accounts, 'https://github.com/acme/new.git')?.id).toBe('work')
  })

  it('rejects ambiguous repository routing', () => {
    expect(() =>
      normalizeGitHubTokenAccounts([
        { id: 'one', label: 'One', token: 'a', repositories: ['acme/repo'], ssh_key_path: '' },
        { id: 'two', label: 'Two', token: 'b', repositories: ['ACME/REPO'], ssh_key_path: '' },
      ]),
    ).toThrow('assigned to multiple')
  })

  it('quotes SSH key paths for repository-local Git configuration', () => {
    expect(sshCommand("/keys/dominic's key")).toBe("ssh -i '/keys/dominic'\\''s key' -o IdentitiesOnly=yes")
  })
})
