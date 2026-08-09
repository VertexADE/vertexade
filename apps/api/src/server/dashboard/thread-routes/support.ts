import { and, eq } from 'drizzle-orm'
import { jobs, pullRequests, repositories } from '../../database/schema/tables.ts'
import { jobRecord, pullRequestRecord, repositoryRecord } from '../../database/contract-records.ts'
import { runtimeDb as db, runtimeJson as json } from '../runtime-context.ts'

export type ThreadRoute = (request: Request, url: URL) => Promise<Response | null>
export type MatchedThreadRoute = {
  method: string
  pattern: RegExp
  handle: (request: Request, url: URL, match: RegExpMatchArray) => Promise<Response>
}

export async function matchThreadRoute(request: Request, url: URL, routes: readonly MatchedThreadRoute[]) {
  for (const route of routes) {
    if (request.method !== route.method) continue
    const match = url.pathname.match(route.pattern)
    if (!match) continue
    try {
      return await route.handle(request, url, match)
    } catch (error) {
      if (error instanceof ThreadRouteError) return json(error.status, { error: error.message })
      throw error
    }
  }
  return null
}

export function rejectThreadRoute(status: number, message: string): never {
  throw new ThreadRouteError(status, message)
}

class ThreadRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function storedJob(jobId: number) {
  return serializedRecord(db.select().from(jobs).where(eq(jobs.id, jobId)).get(), jobRecord)
}

export function storedRepository(repositoryId: number) {
  return serializedRecord(db.select().from(repositories).where(eq(repositories.id, repositoryId)).get(), repositoryRecord)
}

export function storedPullRequest(repositoryId: number, number: number) {
  return serializedRecord(
    db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repositoryId), eq(pullRequests.number, number)))
      .get(),
    pullRequestRecord,
  )
}

function serializedRecord<T, Result>(record: T | undefined, serialize: (record: T) => Result) {
  return record === undefined ? null : serialize(record)
}
