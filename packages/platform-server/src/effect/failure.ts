import { Data } from 'effect'
import { HttpError } from '../http.ts'

export type ApiFailureKind = 'validation' | 'authentication' | 'not_found' | 'conflict' | 'unavailable' | 'upstream' | 'unexpected'

export class ApiFailure extends Data.TaggedError('ApiFailure')<{
  readonly kind: ApiFailureKind
  readonly message: string
  readonly status: number
  readonly code?: string
  readonly cause?: unknown
}> {}

export type ApiFailureFallback = {
  kind: ApiFailureKind
  message: string
  status: number
  code?: string
  causeMessage?: 'append' | 'replace' | 'ignore'
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error || 'Unknown error')
}

function httpFailureKind(status: number, fallback: ApiFailureKind) {
  if ([400, 413, 422].includes(status)) return 'validation'
  if ([401, 403].includes(status)) return 'authentication'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 503) return 'unavailable'
  if ([502, 504].includes(status)) return 'upstream'
  return fallback
}

export function apiFailure(fallback: ApiFailureFallback, cause?: unknown) {
  const { causeMessage = 'append', ...failure } = fallback
  const causeText = errorMessage(cause)
  return new ApiFailure({
    ...failure,
    message:
      cause === undefined || causeMessage === 'ignore'
        ? fallback.message
        : causeMessage === 'replace' && cause instanceof Error && cause.message
          ? causeText
          : `${fallback.message}: ${causeText}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

export function apiFailureFromUnknown(error: unknown, fallback: ApiFailureFallback) {
  if (error instanceof ApiFailure) return error
  if (error instanceof HttpError) {
    return new ApiFailure({
      kind: httpFailureKind(error.status, fallback.kind),
      message: error.message,
      status: error.status,
      ...(fallback.code ? { code: fallback.code } : {}),
      cause: error,
    })
  }
  return apiFailure(fallback, error)
}

export function toHttpError(failure: ApiFailure) {
  return new HttpError(failure.message, failure.status)
}
