import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  agentLaunchOptions,
  api,
  backendApi,
  createScopedApi,
  dateValue,
  isNotificationEvent,
  isThreadEvent,
  isWorkBoardEvent,
  platformBackendState,
  platformClient,
  platformClientForBackend,
  saveAgentLaunchOptions,
  subscribeToDashboardEvents,
} from './dashboard-api.ts'
import { agentLaunchOptionsStore } from './agent-launch-store.ts'

function browserStorage(initial = '') {
  let value = initial
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => value || null),
    setItem: vi.fn((_key: string, next: string) => {
      value = next
    }),
  })
  return () => value
}

describe('dashboard API client', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the server JSON error when available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not allowed' }, { status: 403 })))
    await expect(api('/api/example')).rejects.toThrow('Not allowed')
  })

  it('keeps useful status and body context for non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })))
    await expect(api('/api/example')).rejects.toThrow('Request failed (502): Bad gateway')
  })

  it('rejects invalid JSON from successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })))
    await expect(api('/api/example')).rejects.toThrow('Server returned an invalid response')
  })

  it('routes extension calls through the host-provided request function', async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ ok: true }))
    await expect(createScopedApi(request)('/findings')).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('/findings', expect.objectContaining({ method: 'GET' }))
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('content-type')).toBe('application/json')
  })

  it('routes unscoped operations through an explicit owning backend', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    await expect(backendApi('team', '/api/work-items', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api/backends/team/work-items', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps ordinary requests federated even when an obsolete active-server preference exists', async () => {
    browserStorage('team')
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)

    await expect(api('/api/settings/system-configuration')).resolves.toEqual({ ok: true })

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers)
    expect(headers.has('x-vertexade-backend')).toBe(false)
  })

  it('keeps extension catalog, settings, and mutations on an explicitly scoped plugin server', async () => {
    browserStorage('team')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ modules: [], configured: true }))
    vi.stubGlobal('fetch', fetch)
    const scopedClient = platformClientForBackend('team')
    const extension = scopedClient.extension('linear')

    await scopedClient.modules.list()
    await extension.request('/settings')
    await extension.request('/settings', { method: 'POST', body: '{}' })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/modules',
      '/api/extensions/linear/settings',
      '/api/extensions/linear/settings',
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('x-vertexade-backend')).toBe('team')
    }
  })

  it('migrates the previous flat agent preference record', () => {
    browserStorage(JSON.stringify({ agentId: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }))
    expect(agentLaunchOptions()).toEqual({
      agentId: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      serviceTier: '',
      allowSubagents: false,
    })
    expect(agentLaunchOptions('claude-code')).toEqual({
      agentId: 'claude-code',
      model: '',
      reasoningEffort: '',
      serviceTier: '',
      allowSubagents: false,
    })
  })

  it('keeps agent preference reads side-effect-free for request header generation', () => {
    const currentStoreState = agentLaunchOptionsStore.state
    browserStorage(JSON.stringify({ agentId: 'codex', model: 'pure-read', reasoningEffort: 'medium' }))

    expect(agentLaunchOptions()).toMatchObject({ agentId: 'codex', model: 'pure-read', reasoningEffort: 'medium' })
    expect(agentLaunchOptionsStore.state).toBe(currentStoreState)
  })

  it('stores model and reasoning preferences independently for every agent', () => {
    const stored = browserStorage()
    saveAgentLaunchOptions({
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      serviceTier: 'priority',
      allowSubagents: true,
    })
    saveAgentLaunchOptions({
      agentId: 'opencode',
      model: 'llm-proxy/umans-coder',
      reasoningEffort: 'high',
      serviceTier: '',
      allowSubagents: false,
    })

    expect(agentLaunchOptions()).toEqual({
      agentId: 'opencode',
      model: 'llm-proxy/umans-coder',
      reasoningEffort: 'high',
      serviceTier: '',
      allowSubagents: false,
    })
    expect(agentLaunchOptions('codex')).toEqual({
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      serviceTier: 'priority',
      allowSubagents: true,
    })
    expect(JSON.parse(stored())).toEqual({
      version: 4,
      agentId: 'opencode',
      byAgent: {
        codex: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', serviceTier: 'priority', allowSubagents: true },
        opencode: {
          model: 'llm-proxy/umans-coder',
          reasoningEffort: 'high',
          serviceTier: '',
          allowSubagents: false,
        },
      },
    })
  })

  it('treats invalid timestamps as missing', () => {
    expect(dateValue('not-a-date')).toBeNull()
  })

  it('accepts millisecond timestamps emitted by OpenCode', () => {
    const timestamp = 1_784_449_843_101
    expect(dateValue(timestamp)?.toISOString()).toBe(new Date(timestamp).toISOString())
  })

  it('accepts Unix-second timestamps from persisted agent records', () => {
    const timestamp = 1_784_449_843
    expect(dateValue(timestamp)?.toISOString()).toBe(new Date(timestamp * 1_000).toISOString())
  })

  it.each(['notification', 'notifications_read', 'notifications_pruned', 'notification_dismissed'])(
    'recognizes %s as a notification-only event',
    (reason) => {
      expect(isNotificationEvent(new MessageEvent('change', { data: JSON.stringify({ reason }) }))).toBe(true)
    },
  )

  it('does not classify unrelated or malformed events as notification events', () => {
    expect(isNotificationEvent(new MessageEvent('change', { data: JSON.stringify({ reason: 'job' }) }))).toBe(false)
    expect(isNotificationEvent(new MessageEvent('change', { data: 'not json' }))).toBe(false)
  })

  it.each(['work_item_updated', 'job_finished', 'thread_started', 'input_required', 'pr_approved', 'repository', 'task_linked'])(
    'recognizes %s as a Work board event',
    (reason) => {
      expect(isWorkBoardEvent(new MessageEvent('change', { data: JSON.stringify({ reason }) }))).toBe(true)
    },
  )

  it.each([
    'connected',
    'agent_message',
    'diff',
    'notification',
    'highlights',
    'extensions_updated',
    'linear_issue_updated',
    'azure_work_item_updated',
    'airtable_records_changed',
    'pr_auto_merge_enabled',
  ])('does not reload the Work board for %s', (reason) => {
    expect(isWorkBoardEvent(new MessageEvent('change', { data: JSON.stringify({ reason }) }))).toBe(false)
  })

  it('scopes run events to the open job', () => {
    expect(
      isThreadEvent(
        new MessageEvent('change', {
          data: JSON.stringify({ reason: 'agent_message', job_id: 42 }),
        }),
        42,
      ),
    ).toBe(true)
    expect(
      isThreadEvent(
        new MessageEvent('change', {
          data: JSON.stringify({ reason: 'agent_message', job_id: 7 }),
        }),
        42,
      ),
    ).toBe(false)
    expect(isThreadEvent(new MessageEvent('change', { data: 'invalid' }), 42)).toBe(false)
  })

  it('audits accepted dashboard events so a continuous agent stream keeps updating', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) === '/api/backends') {
        return Response.json({
          backends: [
            {
              id: 'primary',
              label: 'Primary',
              namespace: 0,
              isDefault: true,
              connected: false,
              lastConnectedAt: null,
              error: null,
              apiPath: '/api',
              realtime: true,
            },
          ],
        })
      }
      expect(String(input)).toBe('/api/events')
      expect(new Headers(init?.headers).get('accept')).toBe('text/event-stream')
      return new Response(
        new ReadableStream({
          start(controller) {
            streamController = controller
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      )
    })
    vi.stubGlobal('fetch', fetch)
    const states: boolean[] = []
    const backendSubscription = platformBackendState().subscribe((backends) => {
      if (backends[0]) states.push(backends[0].connected)
    })
    const listener = vi.fn()
    const cleanup = subscribeToDashboardEvents(listener, isNotificationEvent)
    await vi.waitFor(() => expect(streamController).toBeDefined())
    await vi.waitFor(() => expect(states.at(-1)).toBe(true))

    streamController!.enqueue(encoder.encode('event: change\ndata: {"reason":"job"}\n\n'))
    streamController!.enqueue(encoder.encode('event: change\ndata: {"reason":"notification"}\n\n'))
    await vi.advanceTimersByTimeAsync(100)
    streamController!.enqueue(encoder.encode('event: change\ndata: {"reason":"notification_dismissed"}\n\n'))
    await vi.advanceTimersByTimeAsync(20)

    expect(listener).toHaveBeenCalledOnce()
    streamController!.close()
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input) === '/api/events')).toHaveLength(2))
    cleanup()
    backendSubscription.unsubscribe()
  })
})
