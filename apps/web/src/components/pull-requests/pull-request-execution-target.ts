import { useEffect, useState } from 'react'
import { localBackendId, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, PullRequest } from '@vertexade/ui/lib/dashboard-types'

export type PullRequestExecutionTarget = {
  backend: BackendDescriptor
  repositoryId: number
}

export type VerifiedPullRequestExecutionTarget = PullRequestExecutionTarget & {
  access: 'checking' | 'allowed' | 'denied'
  scmLogin: string | null
}

export function pullRequestExecutionTargets(pr: PullRequest, data: DashboardData): PullRequestExecutionTarget[] {
  const backends = new Map((data.backends || []).map((backend) => [backend.id, backend]))
  return data.repositories
    .filter((repository) => repository.full_name.toLowerCase() === pr.full_name.toLowerCase() && repository.backend_id)
    .flatMap((repository) => {
      const backend = backends.get(repository.backend_id!)
      if (!backend?.connected) return []
      return [{ backend, repositoryId: Number(repository.backend_local_id ?? localBackendId(repository.id)) }]
    })
    .sort((left, right) => Number(right.backend.id === pr.backend_id) - Number(left.backend.id === pr.backend_id))
}

export function defaultPullRequestExecutionTarget(pr: PullRequest, targets: PullRequestExecutionTarget[]) {
  return targets.find((target) => target.backend.id === pr.backend_id) || targets[0] || null
}

export function useVerifiedPullRequestExecutionTargets(pr: PullRequest | null, data: DashboardData) {
  const [targets, setTargets] = useState<VerifiedPullRequestExecutionTarget[]>([])
  useEffect(() => {
    if (!pr) return setTargets([])
    const candidates = pullRequestExecutionTargets(pr, data)
    setTargets(candidates.map((target) => ({ ...target, access: 'checking', scmLogin: null })))
    let active = true
    void Promise.all(
      candidates.map(async (target): Promise<VerifiedPullRequestExecutionTarget> => {
        try {
          const [, user] = await Promise.all([
            backendApi(target.backend.id, `/api/pulls/${target.repositoryId}/${pr.number}/details`),
            backendApi<{ login: string }>(target.backend.id, '/api/scm/me'),
          ])
          return { ...target, access: 'allowed', scmLogin: user.login }
        } catch {
          return { ...target, access: 'denied', scmLogin: null }
        }
      }),
    ).then((verified) => active && setTargets(verified))
    return () => {
      active = false
    }
  }, [data.backends, data.repositories, pr?.full_name, pr?.id])
  return targets
}
