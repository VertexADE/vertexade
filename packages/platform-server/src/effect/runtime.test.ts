import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  ApiFailure,
  apiRequestEffect,
  apiFailureFromUnknown,
  runApiEffect,
  runApiEffectResponse,
  timeoutApiPromise,
  tryApiPromise,
} from './index.ts'
import { HttpError } from '../http.ts'

const unavailable = {
  kind: 'unavailable' as const,
  message: 'Provider is unavailable',
  status: 503,
}

describe('Effect API boundary', () => {
  it('preserves expected HTTP failures in the typed error channel', () => {
    expect(apiFailureFromUnknown(new HttpError('Configure the provider first', 503), unavailable)).toMatchObject({
      _tag: 'ApiFailure',
      kind: 'unavailable',
      message: 'Configure the provider first',
      status: 503,
    })
  })

  it('keeps the failure kind aligned with an existing HTTP status', () => {
    expect(apiFailureFromUnknown(new HttpError('Record not found', 404), unavailable)).toMatchObject({
      kind: 'not_found',
      status: 404,
    })
  })

  it('preserves HTTP failures created inside an independently loaded extension', () => {
    const error = Object.assign(new Error('Azure DevOps work-item-types failed'), {
      name: 'HttpError',
      status: 502,
    })

    const failure = apiFailureFromUnknown(error, unavailable)

    expect(failure).toMatchObject({
      kind: 'upstream',
      message: 'Azure DevOps work-item-types failed',
      status: 502,
    })
    expect(failure.cause).toBe(error)
  })

  it('does not trust HTTP error lookalikes with invalid names or status values', () => {
    const invalidErrors = [
      Object.assign(new Error('Wrong name'), { status: 502 }),
      Object.assign(new Error('Status too low'), { name: 'HttpError', status: 399 }),
      Object.assign(new Error('Status too high'), { name: 'HttpError', status: 600 }),
      Object.assign(new Error('String status'), { name: 'HttpError', status: '502' }),
    ]

    for (const error of invalidErrors) {
      const failure = apiFailureFromUnknown(error, unavailable)
      expect(failure).toMatchObject({ kind: 'unavailable', status: 503 })
      expect(failure.cause).toBe(error)
    }
  })

  it('maps unexpected Promise failures to readable API failures', async () => {
    const program = tryApiPromise(
      async () => {
        throw new Error('connection reset')
      },
      {
        kind: 'upstream',
        message: 'Airtable request failed',
        status: 502,
      },
    )

    await expect(runApiEffect(program)).rejects.toMatchObject({
      name: 'HttpError',
      message: 'Airtable request failed: connection reset',
      status: 502,
    })
  })

  it('converts typed failures into stable JSON responses', async () => {
    const response = await runApiEffectResponse(
      Effect.fail(
        new ApiFailure({
          kind: 'validation',
          message: 'Choose a repository',
          status: 400,
        }),
      ),
      (value) => Response.json(value),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Choose a repository' })
  })

  it('propagates caller cancellation into request workflows', async () => {
    const controller = new AbortController()
    let workflowSignal: AbortSignal | undefined
    const program = apiRequestEffect(
      new Request('http://localhost/api/example'),
      (_request, signal) => {
        workflowSignal = signal
        return new Promise<Response>(() => {})
      },
      {
        kind: 'unexpected',
        message: 'Request failed',
        status: 500,
      },
    )

    const result = runApiEffect(program, { signal: controller.signal })
    await vi.waitFor(() => expect(workflowSignal).toBeDefined())
    controller.abort(new Error('Client disconnected'))

    await expect(result).rejects.toThrow()
    expect(workflowSignal?.aborted).toBe(true)
  })

  it('interrupts timed-out provider work through its AbortSignal', async () => {
    let providerSignal: AbortSignal | undefined
    const program = timeoutApiPromise(
      (signal) => {
        providerSignal = signal
        return new Promise<string>(() => {})
      },
      10,
      {
        kind: 'upstream',
        message: 'Provider request failed',
        status: 502,
      },
      {
        kind: 'upstream',
        message: 'Provider request timed out',
        status: 504,
      },
    )

    await expect(runApiEffect(program)).rejects.toMatchObject({
      name: 'HttpError',
      message: 'Provider request timed out',
      status: 504,
    })
    expect(providerSignal?.aborted).toBe(true)
  })
})
