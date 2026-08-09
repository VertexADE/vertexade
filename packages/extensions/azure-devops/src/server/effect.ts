import { Effect } from 'effect'
import { tryApiPromise } from '@vertexade/platform-server/effect'

export function azureRequestEffect<A>(operationName: string, operation: (signal: AbortSignal) => PromiseLike<A>) {
  return tryApiPromise(operation, {
    kind: 'upstream',
    message: `Azure DevOps ${operationName} failed`,
    status: 502,
    code: 'AZURE_DEVOPS_REQUEST_FAILED',
  }).pipe(Effect.withSpan(`azure-devops.${operationName}`))
}
