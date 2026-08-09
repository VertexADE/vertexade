import { Duration, Effect, Either } from 'effect'
import { type ApiFailureFallback, ApiFailure, apiFailureFromUnknown, toHttpError } from './failure.ts'

export type ApiEffect<A> = Effect.Effect<A, ApiFailure>

export type ApiRunOptions = {
  signal?: AbortSignal | undefined
}

export function tryApi<A>(operation: () => A, fallback: ApiFailureFallback): ApiEffect<A> {
  return Effect.try({
    try: operation,
    catch: (error) => apiFailureFromUnknown(error, fallback),
  })
}

export function tryApiPromise<A>(operation: (signal: AbortSignal) => PromiseLike<A>, fallback: ApiFailureFallback): ApiEffect<A> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => apiFailureFromUnknown(error, fallback),
  })
}

export function timeoutApiPromise<A>(
  operation: (signal: AbortSignal) => PromiseLike<A>,
  timeoutMs: number,
  failure: ApiFailureFallback,
  timeoutFailure: ApiFailureFallback,
): ApiEffect<A> {
  return tryApiPromise(operation, failure).pipe(
    Effect.timeoutFail({
      duration: Duration.millis(timeoutMs),
      onTimeout: () => apiFailureFromUnknown(undefined, timeoutFailure),
    }),
  )
}

export function apiRequestEffect<A>(
  request: Request,
  operation: (request: Request, signal: AbortSignal) => PromiseLike<A>,
  fallback: ApiFailureFallback,
): ApiEffect<A> {
  return tryApiPromise((signal) => operation(new Request(request, { signal }), signal), fallback)
}

export function runApiEffect<A>(program: ApiEffect<A>, options: ApiRunOptions = {}): Promise<A> {
  return Effect.runPromise(Effect.either(program), options).then((result) => {
    if (Either.isLeft(result)) throw toHttpError(result.left)
    return result.right
  })
}

export function runApiEffectResponse<A>(
  program: ApiEffect<A>,
  onSuccess: (value: A) => Response,
  onFailure: (failure: ApiFailure) => Response = (failure) => Response.json({ error: failure.message }, { status: failure.status }),
  options: ApiRunOptions = {},
): Promise<Response> {
  return Effect.runPromise(program.pipe(Effect.match({ onFailure, onSuccess })), options)
}
