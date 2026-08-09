import { handleThreadArtifactRoutes } from './thread-routes/artifacts.ts'
import { handleThreadControlRoutes } from './thread-routes/control.ts'
import { handleThreadLifecycleRoutes } from './thread-routes/lifecycle.ts'
import { handleThreadReviewRoutes } from './thread-routes/review.ts'
import type { ThreadRoute } from './thread-routes/support.ts'

const threadRoutes: readonly ThreadRoute[] = [
  handleThreadReviewRoutes,
  handleThreadControlRoutes,
  handleThreadLifecycleRoutes,
  handleThreadArtifactRoutes,
]

export async function handleThreadApi(request: Request, url: URL): Promise<Response | null> {
  for (const route of threadRoutes) {
    const response = await route(request, url)
    if (response) return response
  }
  return null
}
