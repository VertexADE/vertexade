import { describe, expect, it, vi } from 'vite-plus/test'
import { SonarQubeClient } from './client.ts'

const config = {
  url: 'https://sonar.example/',
  projectKeys: ['checkout', 'payments'],
  token: 'secret',
}

describe('SonarQubeClient', () => {
  it('discovers accessible projects and normalizes their metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        paging: { pageIndex: 1, pageSize: 500, total: 2 },
        components: [
          {
            key: 'payments',
            name: 'Payments',
            qualifier: 'TRK',
            visibility: 'private',
            lastAnalysisDate: '2026-07-20T10:00:00Z',
          },
          { key: 'checkout', name: 'Checkout', qualifier: 'TRK', visibility: 'public' },
        ],
      }),
    )

    await expect(new SonarQubeClient(config, fetchMock).projects()).resolves.toEqual([
      {
        key: 'checkout',
        name: 'Checkout',
        qualifier: 'TRK',
        visibility: 'public',
        last_analysis_date: '',
      },
      {
        key: 'payments',
        name: 'Payments',
        qualifier: 'TRK',
        visibility: 'private',
        last_analysis_date: '2026-07-20T10:00:00Z',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sonar.example/api/components/search?ps=500&p=1&qualifiers=TRK',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
  })

  it('discovers projects across SonarQube Cloud organizations', async () => {
    const cloudConfig = { ...config, url: 'https://sonarcloud.io' }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ key: 'acme' }, { key: 'labs' }]))
      .mockResolvedValueOnce(
        Response.json({
          paging: { total: 1 },
          components: [{ key: 'checkout', name: 'Checkout' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          paging: { total: 1 },
          components: [{ key: 'payments', name: 'Payments', visibility: 'private' }],
        }),
      )

    await expect(new SonarQubeClient(cloudConfig, fetchMock).projects()).resolves.toMatchObject([
      { key: 'checkout', qualifier: 'TRK' },
      { key: 'payments', visibility: 'private' },
    ])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.sonarcloud.io/organizations/organizations',
      'https://sonarcloud.io/api/components/search?ps=500&p=1&organization=acme',
      'https://sonarcloud.io/api/components/search?ps=500&p=1&organization=labs',
    ])
  })

  it('loads unresolved findings across every selected project', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        issues: [
          {
            key: 'issue-1',
            message: 'Avoid this',
            component: 'payments:src/pay.ts',
            project: 'payments',
            severity: 'CRITICAL',
            issueStatus: 'OPEN',
            impacts: [{ softwareQuality: 'SECURITY', severity: 'HIGH' }],
            textRange: { startLine: 12 },
          },
        ],
      }),
    )

    await expect(new SonarQubeClient(config, fetchMock).findings()).resolves.toMatchObject([
      { id: 'issue-1', project: 'payments', type: 'SECURITY', line: 12 },
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain('componentKeys=checkout%2Cpayments')
    expect(String(fetchMock.mock.calls[0][0])).toContain('p=1')
  })

  it('reports the SonarQube result-window limit instead of returning a partial queue', async () => {
    let page = 0
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ paging: { total: 10_001 }, issues: [{ key: `issue-${(page += 1)}` }] }),
    )
    await expect(new SonarQubeClient(config, fetchMock).findings()).rejects.toThrow('10,000-result API window')
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })

  it('combines issue, rule, source, and changelog data for details', async () => {
    const issueResponse = {
      issues: [
        {
          key: 'issue-1',
          message: 'Avoid this',
          component: 'checkout:src/cart.ts',
          project: 'checkout',
          organization: 'acme',
          severity: 'MAJOR',
          issueStatus: 'OPEN',
          type: 'CODE_SMELL',
          rule: 'ts:S1234',
          line: 20,
          effort: '15min',
          author: 'ada@example.com',
          assignee: 'ada',
          cleanCodeAttribute: 'FOCUSED',
          tags: ['pitfall'],
          impacts: [{ softwareQuality: 'MAINTAINABILITY', severity: 'MEDIUM' }],
          flows: [
            {
              description: 'Related path',
              locations: [
                {
                  component: 'checkout:src/input.ts',
                  msg: 'Input enters here',
                  textRange: { startLine: 4, endLine: 4 },
                },
              ],
            },
          ],
          comments: [
            {
              key: 'comment-1',
              login: 'ada',
              markdown: 'Investigating',
              createdAt: '2026-07-20T09:00:00Z',
            },
          ],
        },
      ],
      components: [
        { key: 'checkout', name: 'Checkout' },
        { key: 'checkout:src/cart.ts', name: 'cart.ts', longName: 'src/cart.ts' },
      ],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(issueResponse))
      .mockResolvedValueOnce(
        Response.json({
          rule: {
            key: 'ts:S1234',
            name: 'Use a clearer construct',
            langName: 'TypeScript',
            severity: 'MAJOR',
            type: 'CODE_SMELL',
            status: 'READY',
            htmlDesc: '<p>Prefer the safer API.</p>',
            tags: ['clarity'],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          changelog: [
            {
              creationDate: '2026-07-20T10:00:00Z',
              userName: 'Ada',
              diffs: [{ key: 'status', oldValue: 'OPEN', newValue: 'ACCEPTED' }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          sources: [{ line: 20, code: '<span>unsafe()</span>', scmAuthor: 'Ada', isNew: true }],
        }),
      )

    await expect(new SonarQubeClient(config, fetchMock).findingDetails('issue-1')).resolves.toMatchObject({
      id: 'issue-1',
      project_name: 'Checkout',
      component_name: 'cart.ts',
      rule_key: 'ts:S1234',
      clean_code_attribute: 'FOCUSED',
      impacts: [{ quality: 'MAINTAINABILITY', severity: 'MEDIUM' }],
      rule: {
        name: 'Use a clearer construct',
        language: 'TypeScript',
        description: 'Prefer the safer API.',
      },
      source: [{ line: 20, code: 'unsafe()', scm_author: 'Ada', is_new: true }],
      changelog: [{ user: 'Ada', diffs: [{ key: 'status', old_value: 'OPEN', new_value: 'ACCEPTED' }] }],
      flows: [
        {
          description: 'Related path',
          locations: [{ component: 'checkout:src/input.ts', message: 'Input enters here', start_line: 4 }],
        },
      ],
      comments: [{ key: 'comment-1', login: 'ada', markdown: 'Investigating' }],
      detail_errors: [],
    })
    expect(String(fetchMock.mock.calls[1][0])).toContain('key=ts%3AS1234&organization=acme')
  })
})
