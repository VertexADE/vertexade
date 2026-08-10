import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { MigrationCampaignService } from './migration-service.ts'

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new HttpError(`${label} must be a positive integer`, 400)
  return result
}

async function requestResult<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof HttpError) throw error
    const message = error instanceof Error ? error.message : String(error || 'Migration request failed')
    throw new HttpError(message, /not found/i.test(message) ? 404 : /not awaiting|only|explicit|changed|maximum/i.test(message) ? 409 : 400)
  }
}

export function createMigrationRoutes(migrations: MigrationCampaignService): HttpRouter {
  const router = new HttpRouter()

  router.get('/api/migration-recipes', () => Response.json({ recipes: migrations.recipes() }))

  router.post('/api/migration-recipes', async (request) => {
    return Response.json(await requestResult(async () => migrations.createRecipe(await readJsonObject(request))), { status: 201 })
  })

  router.get('/api/migration-campaigns', (request) => {
    const federationGroupId = new URL(request.url).searchParams.get('federationGroupId')
    return Response.json({ campaigns: migrations.list(federationGroupId) })
  })

  router.post('/api/migration-campaigns', async (request) => {
    return Response.json(await requestResult(async () => migrations.createCampaign(await readJsonObject(request), request.signal)), {
      status: 201,
    })
  })

  router.get('/api/migration-campaigns/:campaignId', async (_request, { params }) => {
    return Response.json(await requestResult(() => migrations.requireCampaign(positiveInteger(params.campaignId, 'Campaign ID'))))
  })

  router.post('/api/migration-campaigns/:campaignId/control', async (request, { params }) => {
    return Response.json(
      await requestResult(async () =>
        migrations.control(positiveInteger(params.campaignId, 'Campaign ID'), await readJsonObject(request), request.signal),
      ),
    )
  })

  router.get('/api/migration-campaigns/:campaignId/attempts', (request, { params }) => {
    const targetId = new URL(request.url).searchParams.get('targetId')
    return Response.json({
      attempts: migrations.attempts(
        positiveInteger(params.campaignId, 'Campaign ID'),
        targetId ? positiveInteger(targetId, 'Target ID') : null,
      ),
    })
  })

  return router
}
