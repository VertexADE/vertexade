import { Effect, Either } from 'effect'
import { eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { repositories } from './database/schema/tables.ts'
import type { RepositoryEnvironmentProfileService } from './repository-environment-profiles.ts'

type Dependencies = {
  body: (request: Request) => Promise<any>
  database: DrizzleDashboardDatabase
  json: (status: number, value: unknown) => Response
  notify: (reason: string, repositoryId: number) => void
  profiles: RepositoryEnvironmentProfileService
}

function repository(dependencies: Dependencies, rawId: string) {
  return dependencies.database
    .select({ id: repositories.id, full_name: repositories.fullName, local_path: repositories.localPath })
    .from(repositories)
    .where(eq(repositories.id, Number(rawId)))
    .get()
}

async function writeResponse<A>(effect: Effect.Effect<A, Error>, dependencies: Dependencies, invalidMessage: string) {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isLeft(result)) return dependencies.json(400, { error: result.left.message || invalidMessage })
  return dependencies.json(200, result.right)
}

function requestBody(request: Request, dependencies: Dependencies) {
  return Effect.tryPromise({
    try: () => dependencies.body(request),
    catch: () => new Error('Invalid request body'),
  })
}

function clientError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback)
}

export function handleRepositoryEnvironmentApi(
  request: Request,
  url: URL,
  dependencies: Dependencies,
): Response | Promise<Response> | null {
  const match = url.pathname.match(/^\/api\/repositories\/(\d+)\/environment-profiles$/)
  if (!match) return null
  const repo = repository(dependencies, match[1])
  if (!repo) return dependencies.json(404, { error: 'Repository not found' })
  if (request.method === 'GET') {
    return dependencies.json(200, { repository_id: repo.id, profiles: dependencies.profiles.list(repo.id) })
  }
  if (request.method !== 'PUT') return dependencies.json(405, { error: 'Method not allowed' })
  const invalidMessage = 'Invalid repository environment profiles'
  const program = Effect.gen(function* () {
    const input = yield* requestBody(request, dependencies)
    const profiles = yield* Effect.tryPromise({
      try: () => dependencies.profiles.replace(repo, input.profiles),
      catch: (error) => clientError(error, invalidMessage),
    })
    yield* Effect.sync(() => dependencies.notify('repository_environment_profiles_updated', repo.id))
    return { repository_id: repo.id, profiles }
  }).pipe(Effect.withSpan('api.repository-environments.write'))
  return writeResponse(program, dependencies, invalidMessage)
}
