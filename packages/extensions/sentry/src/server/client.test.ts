import { describe, expect, it, vi } from 'vite-plus/test'
import { SentryClient } from './client.ts'

const config = {
  url: 'https://sentry.example',
  organization: 'acme platform',
  project: '',
  token: 'secret',
}

describe('SentryClient', () => {
  it('follows same-origin issue pagination until Sentry reports no more results', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ id: '1', title: 'First', status: 'unresolved' }], {
          headers: {
            link: '<https://sentry.example/api/0/organizations/acme%20platform/issues/?cursor=next>; rel="next"; results="true"',
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json([{ id: '2', title: 'Second', status: 'unresolved' }], {
          headers: {
            link: '<https://sentry.example/api/0/organizations/acme%20platform/issues/?cursor=end>; rel="next"; results="false"',
          },
        }),
      )

    await expect(new SentryClient(config, fetchMock).findings()).resolves.toMatchObject([{ id: '1' }, { id: '2' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not forward credentials to a cross-origin pagination URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json([], {
        headers: { link: '<https://attacker.example/next>; rel="next"; results="true"' },
      }),
    )
    await expect(new SentryClient(config, fetchMock).findings()).rejects.toThrow('unsafe pagination URL')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retrieves and normalizes full issue details from the organization endpoint', async () => {
    const issue = {
      id: '42',
      shortId: 'API-42',
      title: 'Checkout failed',
      culprit: 'checkout.submit',
      permalink: 'https://sentry.example/issues/42',
      level: 'error',
      status: 'unresolved',
      substatus: 'ongoing',
      priority: 'high',
      platform: 'node',
      issueType: 'error',
      issueCategory: 'error',
      count: '150',
      userCount: 12,
      numComments: 3,
      userReportCount: 2,
      firstSeen: '2026-07-01T10:00:00Z',
      lastSeen: '2026-07-20T10:00:00Z',
      project: { slug: 'checkout', platform: 'node' },
      assignedTo: { name: 'Ada', email: 'ada@example.com', type: 'user' },
      firstRelease: { shortVersion: '1.2.0' },
      lastRelease: { version: '1.4.0+build.7' },
      tags: [{ key: 'environment', name: 'Environment', totalValues: 8 }],
      owners: [{ id: 'team-1', name: 'Checkout team', type: 'team' }],
      participants: [{ id: 'user-2', name: 'Grace', type: 'user' }],
      activity: [
        {
          id: 'activity-1',
          type: 'assigned',
          dateCreated: '2026-07-20T09:00:00Z',
          user: { id: 'user-2', name: 'Grace' },
          data: { assignee: 'Ada' },
        },
      ],
      metadata: { type: 'CheckoutError', value: 'Card declined' },
      statusDetails: { actor: 'rule' },
    }
    const event = {
      id: 'event-99',
      eventID: 'event-public-99',
      title: 'Checkout failed',
      platform: 'javascript',
      type: 'error',
      dateCreated: '2026-07-20T10:00:00Z',
      dateReceived: '2026-07-20T10:00:01Z',
      location: 'checkout.ts:42',
      size: 2048,
      tags: [
        { key: 'environment', value: 'production' },
        { key: 'browser', value: 'Chrome' },
      ],
      user: { id: 'customer-1', email: 'customer@example.com', ip_address: '127.0.0.1' },
      sdk: { name: 'sentry.javascript.browser', version: '9.0.0' },
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'CheckoutError',
                value: 'Card declined',
                mechanism: { type: 'generic', handled: false },
                stacktrace: {
                  frames: [
                    {
                      filename: 'checkout.ts',
                      function: 'submit',
                      lineNo: 42,
                      colNo: 7,
                      inApp: true,
                      context: [[42, 'throw error']],
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          type: 'breadcrumbs',
          data: {
            values: [
              {
                timestamp: '2026-07-20T09:59:59Z',
                category: 'http',
                level: 'info',
                message: 'POST /checkout',
              },
            ],
          },
        },
      ],
      contexts: { browser: { name: 'Chrome', version: '126' } },
      metadata: { type: 'CheckoutError', value: 'Card declined' },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(issue)).mockResolvedValueOnce(Response.json(event))

    const details = await new SentryClient(config, fetchMock).findingDetails('issue/42')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sentry.example/api/0/organizations/acme%20platform/issues/issue%2F42/?expand=owners',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sentry.example/api/0/organizations/acme%20platform/issues/issue%2F42/events/latest/',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
    expect(details).toMatchObject({
      id: '42',
      key: 'API-42',
      project: 'checkout',
      priority: 'high',
      platform: 'node',
      comments: 3,
      user_reports: 2,
      assignee: { name: 'Ada', email: 'ada@example.com' },
      first_release: '1.2.0',
      last_release: '1.4.0+build.7',
      tags: [{ key: 'environment', name: 'Environment', total_values: 8 }],
      owners: [{ id: 'team-1', name: 'Checkout team', type: 'team' }],
      participants: [{ id: 'user-2', name: 'Grace', type: 'user' }],
      activity: [{ id: 'activity-1', type: 'assigned', data: { assignee: 'Ada' } }],
      metadata: { type: 'CheckoutError', value: 'Card declined' },
      latest_event: {
        id: 'event-public-99',
        environment: 'production',
        sdk: { name: 'sentry.javascript.browser', version: '9.0.0' },
        exception: {
          type: 'CheckoutError',
          handled: false,
          frames: [{ filename: 'checkout.ts', function: 'submit', line: 42, in_app: true }],
        },
        breadcrumbs: [{ category: 'http', message: 'POST /checkout' }],
        contexts: [{ name: 'browser', values: { name: 'Chrome', version: '126' } }],
      },
    })
  })

  it('keeps issue details available when the latest event cannot be loaded', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: '42', shortId: 'API-42', title: 'Failure', status: 'unresolved' }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))

    await expect(new SentryClient(config, fetchMock).findingDetails('42')).resolves.toMatchObject({
      id: '42',
      latest_event: null,
      latest_event_error: expect.stringContaining('404'),
    })
  })

  it('rejects malformed issue detail responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]))
    await expect(new SentryClient(config, fetchMock).findingDetails('42')).rejects.toThrow('invalid issue response')
  })
})
