import { describe, expect, it, vi } from 'vite-plus/test'
import { resolveScmPresentation } from '@vertexade/platform-contracts'
import { createGitHubScmProvider } from './provider.ts'

describe('GitHub SCM provider', () => {
  it('normalizes repository input into provider-neutral identity', () => {
    const provider = createGitHubScmProvider(async () => '')
    expect(provider.parseRepository('https://github.com/acme/widget.git')).toEqual({
      id: 'acme/widget',
      webUrl: 'https://github.com/acme/widget',
      cloneUrl: 'git@github.com:acme/widget.git',
    })
    expect(provider.parseRepository('acme/widget')).toMatchObject({ id: 'acme/widget' })
    expect(() => provider.parseRepository('widget')).toThrow('owner/repository')
    expect(provider.branchUrl?.('acme/widget', 'feature/a b')).toBe('https://github.com/acme/widget/tree/feature%2Fa%20b')
    expect(provider.parsePullRequestUrl?.('https://github.com/acme/widget/pull/42/files')).toEqual({
      repository: 'acme/widget',
      number: 42,
    })
    expect(provider.parsePullRequestUrl?.('https://gitlab.com/acme/widget/-/merge_requests/42')).toBeNull()
    expect(provider.presentation).toEqual({
      changeRequestLabel: 'pull request',
      changeRequestLabelPlural: 'pull requests',
    })
    expect(provider.referencePresentation?.('acme/widget')).toMatchObject({
      providerName: 'GitHub',
      repositoryUrl: 'https://github.com/acme/widget',
      issueUrlTemplate: 'https://github.com/acme/widget/issues/{number}',
    })
  })

  it('uses platform terminology defaults when an SCM extension omits presentation metadata', () => {
    expect(resolveScmPresentation({})).toEqual({
      changeRequestLabel: 'change request',
      changeRequestLabelPlural: 'change requests',
    })
  })

  it('normalizes the authenticated user without leaking GitHub response fields', async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        login: 'octocat',
        avatar_url: 'https://avatars.example/octocat',
        private: 'ignored',
      }),
    )
    const provider = createGitHubScmProvider(run)
    await expect(provider.currentUser()).resolves.toEqual({
      login: 'octocat',
      avatarUrl: 'https://avatars.example/octocat',
    })
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith('gh', ['api', 'user'])
  })

  it('keeps pull-request mutations behind the SCM contract', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => (args.includes('--input') ? JSON.stringify({ id: 7 }) : ''))
    const provider = createGitHubScmProvider(run)
    const ref = { repository: 'acme/widget', number: 42 }
    await provider.approve(ref, 'Looks good')
    await provider.requestChanges!(ref, 'Please add a regression test')
    await expect(provider.postReviewSuggestions(ref, 'Suggested changes', [{ path: 'src/a.ts', line: 3 }])).resolves.toEqual({ id: 7 })
    expect(run).toHaveBeenNthCalledWith(1, 'gh', ['pr', 'review', '42', '--repo', 'acme/widget', '--approve', '--body', 'Looks good'])
    expect(run).toHaveBeenNthCalledWith(2, 'gh', [
      'pr',
      'review',
      '42',
      '--repo',
      'acme/widget',
      '--request-changes',
      '--body',
      'Please add a regression test',
    ])
    expect(run).toHaveBeenNthCalledWith(3, 'gh', ['api', '--method', 'POST', 'repos/acme/widget/pulls/42/reviews', '--input', '-'], {
      input: JSON.stringify({
        event: 'COMMENT',
        body: 'Suggested changes',
        comments: [{ path: 'src/a.ts', line: 3 }],
      }),
    })
  })

  it('creates draft pull requests with explicit repository and branch boundaries', async () => {
    const run = vi.fn(async () => 'https://github.com/acme/widget/pull/42\n')
    const provider = createGitHubScmProvider(run)

    await expect(
      provider.createPullRequest!({
        repository: 'acme/widget',
        head: 'feature/fix',
        base: 'main',
        title: 'fix: repair flow',
        body: 'Automated flow output.',
        draft: true,
      }),
    ).resolves.toMatchObject({ url: 'https://github.com/acme/widget/pull/42', draft: true })
    expect(run).toHaveBeenCalledWith('gh', [
      'pr',
      'create',
      '--repo',
      'acme/widget',
      '--head',
      'feature/fix',
      '--base',
      'main',
      '--title',
      'fix: repair flow',
      '--body',
      'Automated flow output.',
      '--draft',
    ])
  })

  it('supports inline comments, replies, and thread resolution', async () => {
    const run = vi.fn(async () => JSON.stringify({ id: 7 }))
    const provider = createGitHubScmProvider(run)
    const ref = { repository: 'acme/widget', number: 42 }

    await provider.postInlineComment!(ref, {
      body: 'Please extract this.',
      commitId: 'abc123',
      path: 'src/a.ts',
      line: 8,
      side: 'RIGHT',
    })
    await provider.replyToReviewComment!(ref, 99, 'Fixed in the latest commit.')
    await provider.setReviewThreadResolved!(ref, 'PRRT_123', true)

    expect(run).toHaveBeenNthCalledWith(1, 'gh', ['api', '--method', 'POST', 'repos/acme/widget/pulls/42/comments', '--input', '-'], {
      input: JSON.stringify({
        body: 'Please extract this.',
        commit_id: 'abc123',
        path: 'src/a.ts',
        line: 8,
        side: 'RIGHT',
      }),
    })
    expect(run).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['api', '--method', 'POST', 'repos/acme/widget/pulls/42/comments/99/replies', '--input', '-'],
      {
        input: JSON.stringify({ body: 'Fixed in the latest commit.' }),
      },
    )
    expect(run).toHaveBeenNthCalledWith(3, 'gh', [
      'api',
      'graphql',
      '-f',
      expect.stringContaining('resolveReviewThread'),
      '-f',
      'threadId=PRRT_123',
    ])
  })
})
