import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { AutomationRecipeService } from './automation-recipes.ts'

export function createAutomationRoutes(recipes: AutomationRecipeService) {
  const router = new HttpRouter()

  router.get('/api/automation-recipes', () => Response.json({ recipes: recipes.list() }))
  router.get('/api/automation-runs', (request) => {
    const limit = Number(new URL(request.url).searchParams.get('limit') || 50)
    return Response.json({ runs: recipes.listRuns(limit) })
  })
  router.get('/api/automation-audit', (request) => {
    const limit = Number(new URL(request.url).searchParams.get('limit') || 100)
    return Response.json({ events: recipes.listAuditEvents(limit) })
  })
  router.get('/api/automation-runtime', () => Response.json(recipes.runtimeStatus()))
  router.post('/api/automation-runtime', async (request) => {
    const input = await readJsonObject(request)
    if (typeof input.paused !== 'boolean') throw new HttpError('paused must be a boolean', 400)
    if (input.reason !== undefined && typeof input.reason !== 'string') throw new HttpError('reason must be text', 400)
    return Response.json(recipes.setPaused(input.paused, String(input.reason || '')))
  })

  router.post('/api/automation-recipes', async (request) => {
    const value = recipes.save(await readJsonObject(request))
    await recipes.syncTriggers()
    return Response.json(value, { status: 201 })
  })

  router.patch('/api/automation-recipes/:recipeId', async (request, { params }) => {
    const value = recipes.save(await readJsonObject(request), Number(params.recipeId))
    if (!value) throw new HttpError('Automation recipe not found', 404)
    await recipes.syncTriggers()
    return Response.json(value)
  })

  router.delete('/api/automation-recipes/:recipeId', async (_request, { params }) => {
    if (!recipes.remove(Number(params.recipeId))) throw new HttpError('Automation recipe not found', 404)
    await recipes.syncTriggers()
    return Response.json({ deleted: true })
  })

  router.post('/api/automation-recipes/:recipeId/run', async (_request, { params }) => {
    const id = Number(params.recipeId)
    if (!recipes.get(id)) throw new HttpError('Automation recipe not found', 404)
    try {
      return Response.json(await recipes.run(id), { status: 202 })
    } catch (error) {
      throw new HttpError(error instanceof Error ? error.message : String(error), 409)
    }
  })

  router.post('/api/automation-runs/:runId/approval', async (request, { params }) => {
    const runId = Number(params.runId)
    if (!recipes.getRun(runId)) throw new HttpError('Automation flow not found', 404)
    const input = await readJsonObject(request)
    try {
      return Response.json(recipes.resolveImprovements(runId, input.selectedImprovementIds), {
        status: 202,
      })
    } catch (error) {
      throw new HttpError(error instanceof Error ? error.message : String(error), 409)
    }
  })

  return router
}
