import type { CapabilityExecution, CapabilityKind, CapabilitySchema, CapabilityValue } from '@vertexade/platform-contracts'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { capabilityExecutions } from '../database/schema/tables.ts'
import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { apiFailure, runApiEffect, tryApi, tryApiPromise } from '@vertexade/platform-server/effect'
import { Duration, Effect, Either } from 'effect'

type ExecuteOptions = {
  workflowInstanceId?: number | null
  idempotencyKey?: string | null
  context?: {
    actionId?: string | null
    entityKind?: string | null
    entityKey?: string | null
  }
}

type RuntimeDefaults = { capabilityTimeoutMs: number; retryAttempts: number; retryDelayMs: number }

function boundedText(value: unknown, maximumLength: number) {
  const text = String(value ?? '')
    .trim()
    .slice(0, maximumLength)
  return text || null
}

function failedExecutionStatus(timedOut: boolean, aborted: boolean) {
  if (timedOut) return 'timed-out'
  if (aborted) return 'cancelled'
  return 'failed'
}

function parseValue(value: unknown): CapabilityValue | null {
  if (value === null) return null
  if (typeof value !== 'string') return capabilityValue(value)
  try {
    return JSON.parse(value) as CapabilityValue
  } catch {
    return null
  }
}

function capabilityValue(value: unknown): CapabilityValue {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Capability values must be JSON serializable')
  return JSON.parse(serialized) as CapabilityValue
}

function execution(row: Record<string, unknown>): CapabilityExecution {
  return {
    id: Number(row.id),
    capabilityKind: String(row.capabilityKind) as CapabilityKind,
    capabilityId: String(row.capabilityId),
    moduleId: String(row.moduleId),
    status: String(row.status) as CapabilityExecution['status'],
    workflowInstanceId: row.workflowInstanceId === null ? null : Number(row.workflowInstanceId),
    idempotencyKey: row.idempotencyKey === null ? null : String(row.idempotencyKey),
    contextualActionId: row.contextualActionId === null ? null : String(row.contextualActionId),
    entityKind: row.entityKind === null ? null : String(row.entityKind),
    entityKey: row.entityKey === null ? null : String(row.entityKey),
    input: parseValue(row.input),
    output: parseValue(row.output),
    error: row.error === null ? null : String(row.error),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.maxAttempts),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    startedAt: row.startedAt === null ? null : String(row.startedAt),
    finishedAt: row.finishedAt === null ? null : String(row.finishedAt),
  }
}

function valueType(value: CapabilityValue) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

export function validateCapabilityValue(value: CapabilityValue, schema?: CapabilitySchema, path = '$'): void {
  if (!schema) return
  const actual = valueType(value)
  if (schema.type && !(schema.type === 'number' && actual === 'integer') && actual !== schema.type) {
    throw new Error(`${path} must be ${schema.type}`)
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) throw new Error(`${path} is not an allowed value`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} is too short`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${path} is too long`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} is below the minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} exceeds the maximum`)
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validateCapabilityValue(item, schema.items, `${path}[${index}]`))
  if (value !== null && !Array.isArray(value) && typeof value === 'object') {
    const properties = schema.properties || {}
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key} is required`)
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key]
      if (property) validateCapabilityValue(item, property, `${path}.${key}`)
      else if (schema.additionalProperties === false) throw new Error(`${path}.${key} is not allowed`)
    }
  }
}

export class CapabilityExecutionService {
  readonly #active = new Map<number, AbortController>()

  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly registries: PlatformCapabilityRegistries,
    private readonly notify: (reason: string, id?: number | null) => void = () => undefined,
    private readonly defaults: () => RuntimeDefaults = () => ({
      capabilityTimeoutMs: 30_000,
      retryAttempts: 1,
      retryDelayMs: 250,
    }),
  ) {}

  list(limit = 100) {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 250)
    return this.database
      .select()
      .from(capabilityExecutions)
      .orderBy(desc(capabilityExecutions.id))
      .limit(bounded)
      .all()
      .map((row) => execution(row))
  }

  get(id: number) {
    const row = this.database.select().from(capabilityExecutions).where(eq(capabilityExecutions.id, id)).get()
    return row ? execution(row) : null
  }

  async execute(kind: CapabilityKind, capabilityId: string, input: unknown, options: ExecuteOptions = {}) {
    const capability = this.require(kind, capabilityId)
    const normalizedInput = capabilityValue(input)
    validateCapabilityValue(normalizedInput, capability.inputSchema)
    const idempotencyKey = boundedText(options.idempotencyKey, 200)
    const reusable = this.reusableExecution(kind, capabilityId, idempotencyKey)
    if (reusable.current) return reusable.current
    const runtime = this.defaults()
    const requestedAttempts = capability.retry?.attempts ?? runtime.retryAttempts
    const maxAttempts = Math.min(Math.max(requestedAttempts, 1), 10)
    const id = this.queueExecution({
      capability: {
        kind,
        id: capabilityId,
        moduleId: capability.moduleId,
        input: normalizedInput,
      },
      request: { options, idempotencyKey },
      attempts: {
        retryExecutionId: reusable.retryExecutionId,
        maximum: maxAttempts,
      },
    })
    const controller = new AbortController()
    this.#active.set(id, controller)
    this.database
      .update(capabilityExecutions)
      .set({ status: 'running', startedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(capabilityExecutions.id, id))
      .run()
    this.notify('capability_execution_started', id)
    let timedOut = false
    try {
      return await runApiEffect(
        this.executionEffect({
          kind,
          capabilityId,
          capability,
          normalizedInput,
          options,
          runtime,
          maxAttempts,
          id,
          onTimeout: () => {
            timedOut = true
          },
        }),
        { signal: controller.signal },
      )
    } catch (error) {
      const status = failedExecutionStatus(timedOut, controller.signal.aborted)
      const message = error instanceof Error ? error.message : String(error || 'Capability execution failed')
      this.database
        .update(capabilityExecutions)
        .set({
          status,
          error: message.slice(0, 4_000),
          finishedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(capabilityExecutions.id, id))
        .run()
      this.notify(`capability_execution_${status.replace('-', '_')}`, id)
      return this.get(id)!
    } finally {
      this.#active.delete(id)
    }
  }

  private reusableExecution(kind: CapabilityKind, capabilityId: string, idempotencyKey: string | null) {
    if (!idempotencyKey) {
      return {
        current: null,
        retryExecutionId: null,
      }
    }
    const row = this.database
      .select()
      .from(capabilityExecutions)
      .where(
        and(
          eq(capabilityExecutions.capabilityKind, kind),
          eq(capabilityExecutions.capabilityId, capabilityId),
          eq(capabilityExecutions.idempotencyKey, idempotencyKey),
        ),
      )
      .get()
    if (!row) return { current: null, retryExecutionId: null }
    const current = execution(row)
    return ['queued', 'running', 'succeeded'].includes(current.status)
      ? { current, retryExecutionId: null }
      : { current: null, retryExecutionId: current.id }
  }

  private queueExecution({
    capability,
    request,
    attempts,
  }: {
    capability: {
      kind: CapabilityKind
      id: string
      moduleId: string
      input: CapabilityValue
    }
    request: {
      options: ExecuteOptions
      idempotencyKey: string | null
    }
    attempts: {
      retryExecutionId: number | null
      maximum: number
    }
  }) {
    const { options, idempotencyKey } = request
    const { retryExecutionId, maximum: maxAttempts } = attempts
    const { kind, id: capabilityId, moduleId, input } = capability
    const actionId = boundedText(options.context?.actionId, 200)
    const entityKind = boundedText(options.context?.entityKind, 100)
    const entityKey = boundedText(options.context?.entityKey, 500)
    if (retryExecutionId !== null) {
      this.database
        .update(capabilityExecutions)
        .set({
          status: 'queued',
          moduleId,
          workflowInstanceId: options.workflowInstanceId || null,
          contextualActionId: actionId,
          entityKind,
          entityKey,
          input: sql`${JSON.stringify(input)}`,
          output: null,
          error: null,
          attempts: 0,
          maxAttempts,
          startedAt: null,
          finishedAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(capabilityExecutions.id, retryExecutionId))
        .run()
      return retryExecutionId
    }
    return Number(
      this.database
        .insert(capabilityExecutions)
        .values({
          capabilityKind: kind,
          capabilityId,
          moduleId,
          status: 'queued',
          workflowInstanceId: options.workflowInstanceId || null,
          idempotencyKey,
          contextualActionId: actionId,
          entityKind,
          entityKey,
          input: sql`${JSON.stringify(input)}`,
          maxAttempts,
        })
        .run().lastInsertRowid,
    )
  }

  cancel(id: number) {
    const current = this.get(id)
    if (!current || !['queued', 'running'].includes(current.status)) return false
    this.#active.get(id)?.abort(new Error('Capability execution cancelled'))
    if (!this.#active.has(id)) {
      this.database
        .update(capabilityExecutions)
        .set({
          status: 'cancelled',
          error: 'Capability execution cancelled',
          finishedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(capabilityExecutions.id, id))
        .run()
      this.notify('capability_execution_cancelled', id)
    }
    return true
  }

  private executionEffect({
    kind,
    capabilityId,
    capability,
    normalizedInput,
    options,
    runtime,
    maxAttempts,
    id,
    onTimeout,
  }: {
    kind: CapabilityKind
    capabilityId: string
    capability: ReturnType<CapabilityExecutionService['require']>
    normalizedInput: CapabilityValue
    options: ExecuteOptions
    runtime: RuntimeDefaults
    maxAttempts: number
    id: number
    onTimeout(): void
  }) {
    const timeoutMs = Math.min(Math.max(capability.timeoutMs || runtime.capabilityTimeoutMs, 100), 3_600_000)
    const retryDelayMs = Math.min(Math.max(capability.retry?.delayMs ?? runtime.retryDelayMs, 0), 60_000)

    return Effect.gen(this, function* () {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        yield* tryApi(
          () =>
            this.database
              .update(capabilityExecutions)
              .set({ attempts: attempt, updatedAt: sql`CURRENT_TIMESTAMP` })
              .where(eq(capabilityExecutions.id, id))
              .run(),
          {
            kind: 'unexpected',
            message: 'Could not update capability execution',
            status: 500,
            code: 'CAPABILITY_PERSISTENCE_FAILED',
          },
        )

        const attemptResult = yield* Effect.either(
          tryApiPromise((signal) => Promise.resolve(this.invoke(kind, capability, normalizedInput, signal, options.workflowInstanceId)), {
            kind: 'upstream',
            message: 'Capability execution failed',
            status: 502,
            code: 'CAPABILITY_INVOCATION_FAILED',
            causeMessage: 'replace',
          }).pipe(
            Effect.timeoutFail({
              duration: Duration.millis(timeoutMs),
              onTimeout: () => {
                onTimeout()
                return apiFailure({
                  kind: 'upstream',
                  message: `Capability timed out after ${timeoutMs}ms`,
                  status: 504,
                  code: 'CAPABILITY_TIMEOUT',
                })
              },
            }),
          ),
        )

        if (Either.isLeft(attemptResult)) {
          if (attemptResult.left.code === 'CAPABILITY_TIMEOUT' || attempt === maxAttempts) {
            return yield* Effect.fail(attemptResult.left)
          }
          yield* Effect.sleep(Duration.millis(retryDelayMs))
          continue
        }

        const normalizedOutput = yield* tryApi(
          () => {
            const output = capabilityValue(attemptResult.right)
            validateCapabilityValue(output, capability.outputSchema)
            return output
          },
          {
            kind: 'validation',
            message: 'Capability returned invalid output',
            status: 422,
            code: 'CAPABILITY_OUTPUT_INVALID',
            causeMessage: 'replace',
          },
        )
        yield* tryApi(
          () =>
            this.database
              .update(capabilityExecutions)
              .set({
                status: 'succeeded',
                output: JSON.stringify(normalizedOutput),
                error: null,
                finishedAt: sql`CURRENT_TIMESTAMP`,
                updatedAt: sql`CURRENT_TIMESTAMP`,
              })
              .where(eq(capabilityExecutions.id, id))
              .run(),
          {
            kind: 'unexpected',
            message: 'Could not save capability output',
            status: 500,
            code: 'CAPABILITY_PERSISTENCE_FAILED',
          },
        )
        this.notify('capability_execution_succeeded', id)
        return this.get(id)!
      }
      return yield* Effect.fail(
        apiFailure({
          kind: 'unexpected',
          message: 'Capability execution did not complete',
          status: 500,
          code: 'CAPABILITY_DID_NOT_COMPLETE',
        }),
      )
    }).pipe(Effect.withSpan(`capability.execute ${kind} ${capabilityId}`))
  }

  private require(kind: CapabilityKind, id: string) {
    if (kind === 'action') return this.registries.actions.require(id)
    if (kind === 'query') return this.registries.queries.require(id)
    if (kind === 'transform') return this.registries.transforms.require(id)
    if (kind === 'gate') return this.registries.gates.require(id)
    if (kind === 'evidence') return this.registries.evidence.require(id)
    return this.registries.requireCustom(kind, id)
  }

  private invoke(
    kind: CapabilityKind,
    capability: ReturnType<CapabilityExecutionService['require']>,
    input: CapabilityValue,
    signal: AbortSignal,
    workflowInstanceId?: number | null,
  ) {
    const context = {
      moduleId: capability.moduleId,
      signal,
      ...(workflowInstanceId ? { workflowInstanceId } : {}),
    }
    if (kind === 'action' && 'execute' in capability) return capability.execute(input, context)
    if (kind === 'query' && 'query' in capability) return capability.query(input, context)
    if (kind === 'transform' && 'transform' in capability) return capability.transform(input, context)
    if (kind === 'gate' && 'evaluate' in capability) return capability.evaluate(input, context)
    if (kind === 'evidence' && 'collect' in capability) return capability.collect(input, context)
    if ('run' in capability) return capability.run(input, context)
    throw new Error(`Capability ${capability.id} does not implement ${kind}`)
  }
}
