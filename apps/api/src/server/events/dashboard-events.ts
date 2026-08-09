type EventClient = {
  id: number
  identity: string
  send(payload: string): boolean
  close(): void
}

export type DashboardEventLimits = {
  heartbeatMilliseconds: number
  maxClients: number
  maxClientsPerIdentity: number
  maxQueuedBytes: number
  maxEventBytes: number
}

const defaultLimits: DashboardEventLimits = {
  heartbeatMilliseconds: 25_000,
  maxClients: 64,
  maxClientsPerIdentity: 4,
  maxQueuedBytes: 256 * 1024,
  maxEventBytes: 64 * 1024,
}

function boundedInteger(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  return parsed
}

export function configuredDashboardEventLimits(environment: NodeJS.ProcessEnv = process.env): DashboardEventLimits {
  const limits = {
    heartbeatMilliseconds: boundedInteger('VERTEXADE_SSE_HEARTBEAT_MS', environment.VERTEXADE_SSE_HEARTBEAT_MS, 25_000, 1_000, 60_000),
    maxClients: boundedInteger('VERTEXADE_SSE_MAX_CONNECTIONS', environment.VERTEXADE_SSE_MAX_CONNECTIONS, 64, 1, 4_096),
    maxClientsPerIdentity: boundedInteger(
      'VERTEXADE_SSE_MAX_CONNECTIONS_PER_IP',
      environment.VERTEXADE_SSE_MAX_CONNECTIONS_PER_IP,
      4,
      1,
      128,
    ),
    maxQueuedBytes: boundedInteger(
      'VERTEXADE_SSE_MAX_QUEUE_BYTES',
      environment.VERTEXADE_SSE_MAX_QUEUE_BYTES,
      256 * 1024,
      4 * 1024,
      8 * 1024 * 1024,
    ),
    maxEventBytes: boundedInteger('VERTEXADE_SSE_MAX_EVENT_BYTES', environment.VERTEXADE_SSE_MAX_EVENT_BYTES, 64 * 1024, 1024, 1024 * 1024),
  }
  if (limits.maxClientsPerIdentity > limits.maxClients)
    throw new Error('VERTEXADE_SSE_MAX_CONNECTIONS_PER_IP must not exceed VERTEXADE_SSE_MAX_CONNECTIONS')
  if (limits.maxEventBytes > limits.maxQueuedBytes)
    throw new Error('VERTEXADE_SSE_MAX_EVENT_BYTES must not exceed VERTEXADE_SSE_MAX_QUEUE_BYTES')
  return limits
}

function eventTopic(reason: string) {
  if (reason === 'connected') return 'connection'
  if (reason.startsWith('notification')) return 'notifications'
  if (reason.startsWith('work_') || reason === 'task_linked') return 'work'
  if (['job_', 'thread_', 'input_', 'action_', 'agent_', 'review_', 'diff', 'steer_'].some((prefix) => reason.startsWith(prefix)))
    return 'runs'
  if (['automation_', 'capability_', 'schedule_'].some((prefix) => reason.startsWith(prefix))) return 'automations'
  if (['extension_', 'extensions_', 'module_'].some((prefix) => reason.startsWith(prefix))) return 'extensions'
  if (reason.startsWith('pr_') || ['repository', 'labels', 'highlights', 'presets'].includes(reason)) return 'dashboard'
  return 'platform'
}

function entityKind(topic: string) {
  if (topic === 'work') return 'work-item'
  if (topic === 'runs') return 'job'
  if (topic === 'notifications') return 'notification'
  if (topic === 'automations') return 'automation'
  if (topic === 'extensions') return 'extension'
  return null
}

function eventOperation(reason: string) {
  for (const operation of ['created', 'updated', 'deleted', 'finished', 'failed', 'started', 'archived', 'restored']) {
    if (reason.endsWith(`_${operation}`)) return operation
  }
  return reason === 'connected' ? 'connected' : 'changed'
}

export class DashboardEvents {
  readonly #clients = new Map<number, EventClient>()
  readonly #heartbeat: ReturnType<typeof setInterval>
  readonly #limits: DashboardEventLimits
  readonly #encoder = new TextEncoder()
  #sequence = 0
  #clientSequence = 0
  #rejected = 0
  #slowDisconnected = 0
  #closed = 0

  constructor(limits: Partial<DashboardEventLimits> = {}) {
    this.#limits = { ...defaultLimits, ...limits }
    this.#heartbeat = setInterval(() => {
      for (const client of this.#clients.values()) client.send(': heartbeat\n\n')
    }, this.#limits.heartbeatMilliseconds)
    this.#heartbeat.unref()
  }

  emit(reason: string, id: number | null = null) {
    const topic = eventTopic(reason)
    const sequence = ++this.#sequence
    const data = {
      sequence,
      reason,
      topic,
      entity_kind: entityKind(topic),
      entity_id: id,
      job_id: id,
      operation: eventOperation(reason),
      time: new Date().toISOString(),
    }
    const payload = `id: ${sequence}\nevent: change\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.#clients.values()) client.send(payload)
  }

  #identityCount(identity: string) {
    let count = 0
    for (const client of this.#clients.values()) if (client.identity === identity) count += 1
    return count
  }

  stream({ signal, identity }: { signal: AbortSignal; identity: string }) {
    if (this.#clients.size >= this.#limits.maxClients || this.#identityCount(identity) >= this.#limits.maxClientsPerIdentity) {
      this.#rejected += 1
      return Response.json(
        { error: 'Event stream connection limit reached' },
        { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
      )
    }
    const clientId = ++this.#clientSequence
    let client: EventClient | undefined
    let removeAbort: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let closed = false
          const close = () => {
            if (closed) return
            closed = true
            this.#clients.delete(clientId)
            removeAbort?.()
            this.#closed += 1
            try {
              controller.close()
            } catch {}
          }
          const send = (payload: string) => {
            if (closed) return false
            const encoded = this.#encoder.encode(payload)
            if (encoded.byteLength > this.#limits.maxEventBytes || (controller.desiredSize ?? 0) < encoded.byteLength) {
              this.#slowDisconnected += 1
              close()
              return false
            }
            try {
              controller.enqueue(encoded)
              return true
            } catch {
              close()
              return false
            }
          }
          client = { id: clientId, identity, send, close }
          this.#clients.set(clientId, client)
          const abort = () => close()
          signal.addEventListener('abort', abort, { once: true })
          removeAbort = () => signal.removeEventListener('abort', abort)
          const sequence = ++this.#sequence
          client.send(
            `retry: 2000\nid: ${sequence}\nevent: change\ndata: ${JSON.stringify({
              sequence,
              reason: 'connected',
              topic: 'connection',
              entity_kind: null,
              entity_id: null,
              job_id: null,
              operation: 'connected',
              time: new Date().toISOString(),
              resync: true,
            })}\n\n`,
          )
        },
        cancel: () => {
          client?.close()
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: this.#limits.maxQueuedBytes }),
    )
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  }

  stats() {
    return {
      connected: this.#clients.size,
      rejected: this.#rejected,
      slow_disconnected: this.#slowDisconnected,
      closed: this.#closed,
    }
  }

  dispose() {
    clearInterval(this.#heartbeat)
    for (const client of [...this.#clients.values()]) client.close()
    this.#clients.clear()
  }
}
