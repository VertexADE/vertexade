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

function httpErrorDetails(error: unknown) {
  if (!(error instanceof Error) || error.name !== 'HttpError') return null
  const status = (error as Error & { status?: unknown }).status
  if (!Number.isInteger(status) || Number(status) < 400 || Number(status) > 599) return null
  return { message: error.message, status: Number(status) }
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
  const httpError = error instanceof HttpError ? { message: error.message, status: error.status } : httpErrorDetails(error)
  if (httpError) {
    return new ApiFailure({
      kind: httpFailureKind(httpError.status, fallback.kind),
      message: httpError.message,
      status: httpError.status,
      ...(fallback.code ? { code: fallback.code } : {}),
      cause: error,
    })
  }
  return apiFailure(fallback, error)
}

export function toHttpError(failure: ApiFailure) {
  return new HttpError(failure.message, failure.status)
}
