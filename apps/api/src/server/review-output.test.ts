import { describe, expect, it } from 'vite-plus/test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isCompleteDetailedReview, resolveDetailedReviewOutput } from './review-output.ts'

const completeReview = `## Findings
No actionable findings.
## Intended outcome
Understood.
## Quality scorecard
Good.
## Recommendation
Approve.
## Validation
Tests passed.`

describe('detailed review output', () => {
  it('recognizes the complete first-turn review contract', () => {
    expect(isCompleteDetailedReview(completeReview)).toBe(true)
    expect(isCompleteDetailedReview('## Findings\nOnly one section.')).toBe(false)
  })

  it('keeps a complete first-turn assistant message verbatim', async () => {
    await expect(resolveDetailedReviewOutput(completeReview, '/missing-worktree')).resolves.toBe(completeReview)
  })

  it('recovers a complete report artifact inside the review worktree', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'review-output-'))
    try {
      const report = join(worktree, 'pr-review.md')
      await writeFile(report, completeReview)
      await expect(resolveDetailedReviewOutput(`Review written to: \`${report}\``, worktree)).resolves.toBe(completeReview)
    } finally {
      await rm(worktree, { recursive: true })
    }
  })

  it('does not read a referenced report outside the review worktree', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'review-output-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'review-output-outside-'))
    try {
      const report = join(outside, 'pr-review.md')
      await writeFile(report, completeReview)
      await symlink(report, join(worktree, 'pr-review.md'))
      const pointer = `Review written to: \`${join(worktree, 'pr-review.md')}\``
      await expect(resolveDetailedReviewOutput(pointer, worktree)).resolves.toBe(pointer)
    } finally {
      await rm(worktree, { recursive: true })
      await rm(outside, { recursive: true })
    }
  })

  it('ignores an incomplete report artifact', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'review-output-incomplete-'))
    const pointer = `Review written to: \`${join(worktree, 'pr-review.md')}\``
    try {
      await writeFile(join(worktree, 'pr-review.md'), '## Findings\nIncomplete review.')
      await expect(resolveDetailedReviewOutput(pointer, worktree)).resolves.toBe(pointer)
    } finally {
      await rm(worktree, { recursive: true })
    }
  })
})
