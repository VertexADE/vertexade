import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DevelopmentArtifactKind, DevelopmentIntelligenceOverview } from '@vertexade/platform-contracts'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'

export function useDevelopmentRepositorySelection(repositories: Repository[]) {
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
  const selected = useMemo(() => repositories.find((repository) => repository.id === repositoryId) || null, [repositories, repositoryId])

  useEffect(() => {
    if (!repositoryId && repositories[0]) setRepositoryId(repositories[0].id)
  }, [repositories, repositoryId])

  return { repositoryId, setRepositoryId, selected }
}

function developmentArtifactPath(kind: DevelopmentArtifactKind, repositoryId: number, artifactId: number): string {
  return kind === 'impact_analysis'
    ? `/api/repositories/${repositoryId}/impact-analyses/${artifactId}`
    : `/api/repositories/${repositoryId}/architecture-index/${artifactId}`
}

export function useDevelopmentIntelligenceOverview(kind: DevelopmentArtifactKind, repositoryId: number, artifactId: number) {
  const artifactPath = developmentArtifactPath(kind, repositoryId, artifactId)
  const queryKey = platformQueryKey(`${artifactPath}/intelligence`)
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<DevelopmentIntelligenceOverview>(`${artifactPath}/intelligence`, { signal }),
    refetchInterval: (state) =>
      state.state.data?.investigations.some((investigation) => ['starting', 'running', 'queued'].includes(investigation.status))
        ? 5_000
        : false,
  })
  return { artifactPath, queryKey, query }
}
