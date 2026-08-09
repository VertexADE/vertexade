import { describe, expect, it, vi } from 'vite-plus/test'
import { CodeRabbitClient, normalizeCodeRabbitConfig } from './client.ts'

describe('CodeRabbitClient', () => {
  it('normalizes repository ids and bot identities', () => {
    expect(
      normalizeCodeRabbitConfig({
        repository_ids: [2, '2', 3],
        bot_logins: ['CodeRabbitAI[bot]', 'coderabbitai'],
      }),
    ).toEqual({ repositoryIds: [2, 3], botLogins: ['coderabbitai'] })
  })

  it('returns only unresolved CodeRabbit-authored review threads', async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 42,
                  title: 'Checkout',
                  url: 'https://github.com/acme/app/pull/42',
                  updatedAt: '2026-01-01',
                  reviewThreads: {
                    nodes: [
                      {
                        isResolved: false,
                        isOutdated: false,
                        path: 'src/pay.ts',
                        line: 12,
                        comments: {
                          nodes: [
                            {
                              databaseId: 7,
                              body: '⚠️ Potential issue: missing timeout',
                              url: 'https://github.com/acme/app/pull/42#discussion_r7',
                              author: { login: 'coderabbitai[bot]' },
                            },
                          ],
                        },
                      },
                      {
                        isResolved: true,
                        path: 'src/old.ts',
                        comments: {
                          nodes: [{ databaseId: 8, body: 'Old', author: { login: 'coderabbitai[bot]' } }],
                        },
                      },
                      {
                        isResolved: false,
                        path: 'src/human.ts',
                        comments: {
                          nodes: [{ databaseId: 9, body: 'Human', author: { login: 'ada' } }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    )
    const findings = await new CodeRabbitClient(run, { repositoryIds: [1], botLogins: ['coderabbitai'] }, [
      { id: 1, full_name: 'acme/app' },
    ]).findings()
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      key: 'acme/app#42',
      message: 'src/pay.ts:12',
      severity: 'MEDIUM',
      status: 'open',
      pr_number: 42,
    })
  })

  it('requests an incremental review using the documented PR command', async () => {
    const run = vi.fn(async () => JSON.stringify({ html_url: 'https://github.com/acme/app/pull/42#comment-1' }))
    await new CodeRabbitClient(run, { repositoryIds: [1], botLogins: ['coderabbitai'] }, [{ id: 1, full_name: 'acme/app' }]).requestReview(
      'acme/app',
      42,
    )
    expect(run).toHaveBeenCalledWith('gh', expect.arrayContaining(['body=@coderabbitai review']))
  })
})
