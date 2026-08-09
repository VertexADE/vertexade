import type { CapabilityKind } from '@vertexade/platform-contracts'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { CapabilityExecutionService } from './capability-execution.ts'

const capabilityKindPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export function createCapabilityRoutes(executions: CapabilityExecutionService) {
  const router = new HttpRouter()

  router.get('/api/capability-executions', (request) => {
    const limit = Number(new URL(request.url).searchParams.get('limit') || 100)
    return Response.json({ executions: executions.list(Number.isFinite(limit) ? limit : 100) })
  })

  router.get('/api/capability-executions/:executionId', (_request, { params }) => {
    const value = executions.get(Number(params.executionId))
    if (!value) throw new HttpError('Capability execution not found', 404)
    return Response.json(value)
  })

  router.post('/api/capabilities/:kind/:capabilityId/execute', async (request, { params }) => {
    const kind = String(params.kind || '') as CapabilityKind
    const capabilityId = String(params.capabilityId || '')
    if (!capabilityKindPattern.test(kind)) throw new HttpError('Invalid capability kind', 400)
    if (!capabilityId) throw new HttpError('Capability id is required', 400)
    const input = await readJsonObject(request)
    const context = input.context && typeof input.context === 'object' ? (input.context as Record<string, unknown>) : null
    const result = await executions.execute(kind, capabilityId, input.input ?? null, {
      workflowInstanceId: Number(input.workflowInstanceId) || null,
      idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : null,
      context: context
        ? {
            actionId: typeof context.actionId === 'string' ? context.actionId : null,
            entityKind: typeof context.entityKind === 'string' ? context.entityKind : null,
            entityKey: typeof context.entityKey === 'string' ? context.entityKey : null,
          }
        : undefined,
    })
    return Response.json(result, { status: 201 })
  })

  router.post('/api/capability-executions/:executionId/cancel', (_request, { params }) => {
    const id = Number(params.executionId)
    if (!executions.cancel(id)) throw new HttpError('Capability execution is not active', 409)
    return Response.json({ cancelled: true })
  })

  return router
}
