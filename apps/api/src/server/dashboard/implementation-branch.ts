import { runtimeScmProvider as scmProvider, runtimeWork as work } from './runtime-context.ts'

type RepositoryBranchTarget = {
  id: number
  full_name: string
}

export function linkImplementationBranch(workItemId: number, repository: RepositoryBranchTarget, branchName: string) {
  work.linkResource(workItemId, {
    provider: 'git',
    kind: 'branch',
    externalId: `${repository.full_name}:${branchName}`.toLowerCase(),
    role: 'implementation',
    label: branchName,
    url: scmProvider(repository.full_name).branchUrl?.(repository.full_name, branchName) || null,
    repositoryId: repository.id,
    state: 'local',
    metadata: { repository: repository.full_name, branch: branchName },
  })
}
