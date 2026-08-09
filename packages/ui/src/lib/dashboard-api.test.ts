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
  saveAgentLaunchOptions,
  subscribeToDashboardEvents,
} from './dashboard-api.ts'

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

  it('debounces accepted dashboard events over the shared stream', async () => {
    vi.useFakeTimers()
    class FakeEventSource {
      static instance: FakeEventSource
      listeners = new Map<string, Array<(event: Event) => void>>()
      closed = false

      constructor(readonly url: string) {
        FakeEventSource.instance = this
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener])
      }

      emit(type: string, event: Event) {
        for (const listener of this.listeners.get(type) || []) listener(event)
      }

      close() {
        this.closed = true
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const listener = vi.fn()
    const cleanup = subscribeToDashboardEvents(listener, isNotificationEvent)
    const stream = FakeEventSource.instance

    stream.emit('change', new MessageEvent('change', { data: JSON.stringify({ reason: 'job' }) }))
    stream.emit('change', new MessageEvent('change', { data: JSON.stringify({ reason: 'notification' }) }))
    stream.emit('change', new MessageEvent('change', { data: JSON.stringify({ reason: 'notification_dismissed' }) }))
    await vi.advanceTimersByTimeAsync(120)

    expect(stream.url).toBe('/api/events')
    expect(listener).toHaveBeenCalledOnce()
    cleanup()
    expect(stream.closed).toBe(false)
  })
})
