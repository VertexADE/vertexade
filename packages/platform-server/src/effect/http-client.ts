import { Duration, Effect, Either } from 'effect'
import { ApiFailure, apiFailure } from './failure.ts'
import { type ApiEffect, runApiEffect, tryApiPromise } from './runtime.ts'

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const DEFAULT_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export type ResilientFetchInput = {
  service: string
  fetch: typeof globalThis.fetch
  url: string | URL
  init?: RequestInit
  timeoutMs?: number | null
  attempts?: number
  retryableStatuses?: ReadonlySet<number>
  retryDelayMs?: (response: Response | undefined, attempt: number) => number
}

function defaultRetryDelay(response: Response | undefined, attempt: number) {
  const retryAfterHeader = response?.headers?.get?.('retry-after')
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1_000 : 250 * 2 ** attempt
}

function requestSignal(effectSignal: AbortSignal, requestSignal?: AbortSignal | null) {
  return requestSignal ? AbortSignal.any([effectSignal, requestSignal]) : effectSignal
}

function requestAttempt({ service, fetch, url, init = {}, timeoutMs = 15_000 }: ResilientFetchInput): ApiEffect<Response> {
  const request = tryApiPromise(
    (effectSignal) =>
      fetch(url, {
        ...init,
        signal: requestSignal(effectSignal, init.signal),
      }),
    {
      kind: 'upstream',
      message: `${service} request failed`,
      status: 502,
      code: 'UPSTREAM_REQUEST_FAILED',
    },
  )
  if (timeoutMs === null) return request
  return request.pipe(
    Effect.timeoutFail({
      duration: Duration.millis(timeoutMs),
      onTimeout: () =>
        apiFailure({
          kind: 'upstream',
          message: `${service} request timed out`,
          status: 504,
          code: 'UPSTREAM_TIMEOUT',
        }),
    }),
  )
}

export function resilientFetchEffect(input: ResilientFetchInput): ApiEffect<Response> {
  const method = String(input.init?.method || 'GET').toUpperCase()
  const attempts = Math.max(1, input.attempts ?? (IDEMPOTENT_METHODS.has(method) ? 3 : 1))
  const retryableStatuses = input.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES
  const retryDelayMs = input.retryDelayMs ?? defaultRetryDelay

  return Effect.gen(function* () {
    let lastFailure: ApiFailure | undefined

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = yield* Effect.either(requestAttempt(input))
      const finalAttempt = attempt === attempts - 1

      if (Either.isLeft(result)) {
        lastFailure = result.left
        if (finalAttempt) return yield* Effect.fail(result.left)
        yield* Effect.sleep(Duration.millis(retryDelayMs(undefined, attempt)))
        continue
      }

      const response = result.right
      if (response.ok || !retryableStatuses.has(response.status) || finalAttempt) {
        return response
      }
      yield* Effect.sleep(Duration.millis(retryDelayMs(response, attempt)))
    }

    return yield* Effect.fail(
      lastFailure ??
        apiFailure({
          kind: 'unexpected',
          message: `${input.service} request did not complete`,
          status: 500,
          code: 'REQUEST_DID_NOT_COMPLETE',
        }),
    )
  }).pipe(Effect.withSpan(`http.client ${input.service}`))
}

export function resilientFetch(input: ResilientFetchInput) {
  return runApiEffect(resilientFetchEffect(input))
}
