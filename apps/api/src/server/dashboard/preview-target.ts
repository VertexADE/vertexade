import { and, eq, isNotNull } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { worktreePreviews } from '../database/schema/tables.ts'

function targetFromManifest(value: string, hostname: string) {
  try {
    const services = JSON.parse(value).services || []
    const ports = services.flatMap((service: any) => service.ports || [])
    const match = ports.find((candidate: any) => candidate.protocol === 'tcp' && candidate.hostname === hostname)
    return match ? { hostPort: Number(match.hostPort) } : null
  } catch {
    return null
  }
}

export function createPreviewTargetResolver(database: DrizzleDashboardDatabase) {
  return (hostname: string) =>
    database
      .select({ manifest: worktreePreviews.manifest })
      .from(worktreePreviews)
      .where(and(eq(worktreePreviews.status, 'running'), isNotNull(worktreePreviews.manifest)))
      .all()
      .map(({ manifest }) => targetFromManifest(manifest!, hostname))
      .find(Boolean) || null
}
