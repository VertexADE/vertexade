import { describe, expect, it } from 'vite-plus/test'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { threadTitle, usableThreadTitle } from '@vertexade/ui/lib/thread-title'

function job(value: Partial<Job> = {}): Job {
  return {
    id: 7,
    backend_id: 'local',
    kind: 'task',
    task_title: null,
    kind_title_fallback: null,
    full_name: 'acme/api',
    pr_number: 0,
    ...value,
  } as Job
}

describe('threadTitle', () => {
  it.each([null, undefined, '', 'null', 'undefined'])('rejects unusable stored titles: %s', (title) => {
    expect(usableThreadTitle(title)).toBeNull()
    expect(threadTitle(job({ task_title: title as string | null }))).toBe('Run #7')
  })

  it('uses one consistent pull-request fallback in thread lists and details', () => {
    expect(threadTitle(job({ pr_number: 42 }))).toBe('acme/api · PR #42')
    expect(threadTitle(job({ kind: 'review', pr_number: 42 }))).toBe('Review PR #42')
  })

  it('prefers a normalized stored title', () => {
    expect(threadTitle(job({ task_title: '  Nightly   maintenance ' }))).toBe('Nightly maintenance')
  })

  it('does not render dangling repository separators for repository-less runs', () => {
    expect(threadTitle(job({ kind: 'planning', full_name: '' }))).toBe('Planning #7')
    expect(threadTitle(job({ pr_number: 42, full_name: '' }))).toBe('PR #42')
  })
})
