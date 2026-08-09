import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

export type DeliveryRow = {
  repository: string
  work?: WorkItem['threads'][number]
  review?: WorkItem['threads'][number]
  pullRequest?: WorkItem['resources'][number]
  deployment?: WorkItem['resources'][number]
}

export function buildDeliveryRows(item: WorkItem): DeliveryRow[] {
  const repositoryResources = item.resources.filter((resource) => resource.kind === 'repository')
  return item.repository_names.map((repository) => {
    const repositoryId = repositoryResources.find((resource) => resource.label === repository)?.repository_id
    const jobs = item.threads.filter((job) => job.full_name === repository)
    const work = jobs.find((job) => !['review', 'work_review'].includes(job.kind))
    const review = jobs.find((job) => ['review', 'work_review'].includes(job.kind))
    const pullRequests = item.resources.filter(
      (resource) => resource.kind === 'pull_request' && (!repositoryId || resource.repository_id === repositoryId),
    )
    const deployments = item.resources.filter(
      (resource) => resource.kind === 'deployment' && (!repositoryId || resource.repository_id === repositoryId),
    )
    return {
      repository,
      work,
      review,
      pullRequest: pullRequests[0],
      deployment: deployments.find((resource) => resource.state === 'failed') || deployments[0],
    }
  })
}
