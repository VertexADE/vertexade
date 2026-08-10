import { describe, expect, it } from 'vite-plus/test'
import type { Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { threadBelongsToPullRequest } from './pull-request-thread-association'

describe('pull request thread association', () => {
  it('associates a thread from another server by repository and PR number', () => {
    const pr = { repo_id: 1, number: 42, full_name: 'Acme/App', backend_id: 'source' } as PullRequest
    const remoteThread = { repo_id: 2_000_000_009, pr_number: 42, full_name: 'acme/app', backend_id: 'worker' } as Job
    expect(threadBelongsToPullRequest(remoteThread, pr)).toBe(true)
  })

  it('does not associate the same PR number from another repository', () => {
    const pr = { repo_id: 1, number: 42, full_name: 'Acme/App' } as PullRequest
    const unrelated = { repo_id: 2_000_000_009, pr_number: 42, full_name: 'Acme/Other' } as Job
    expect(threadBelongsToPullRequest(unrelated, pr)).toBe(false)
  })
})
