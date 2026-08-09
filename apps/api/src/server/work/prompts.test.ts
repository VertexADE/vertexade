import { describe, expect, it } from 'vite-plus/test'
import { worktreeCodeReviewPrompt } from './prompts.ts'

describe('worktreeCodeReviewPrompt', () => {
  it('uses the full private code-review contract without consulting a linked PR', () => {
    const prompt = worktreeCodeReviewPrompt({
      key: 'W-0042',
      title: 'Add repository environments',
      description: 'Share isolated environment snapshots across worktrees.',
      repository: 'example/platform',
      connectedRepositories: ['example/platform', 'example/web', 'example/mobile'],
      sourceRunId: 81,
      sourceBranch: 'feature/repository-environments',
      baseSha: 'abc123',
      focus: 'Check secret handling and copy semantics.',
    })

    expect(prompt).toContain('complete lead-engineer code review')
    expect(prompt).toContain('Do not locate, open, fetch, or use a pull request linked to the Work item')
    expect(prompt).toContain('through HEAD, plus staged, unstaged, and untracked')
    expect(prompt).toContain('<work_item>')
    expect(prompt).toContain('Key: W-0042')
    expect(prompt).toContain('Repository under review: example/platform')
    expect(prompt).toContain('Source Work run: #81')
    expect(prompt).toContain('Review base commit: abc123')
    expect(prompt).toContain('Check secret handling and copy semantics.')
    expect(prompt).toContain('Classify two independent dimensions with evidence')
    expect(prompt).toContain('affected-project matrix')
    expect(prompt).toContain('Connected Work item repositories: example/platform, example/web, example/mobile')
    expect(prompt).toContain('only example/platform is present in this isolated snapshot')
    expect(prompt).toContain('1. Scope proof')
    expect(prompt).toContain('10. Hygiene proof')
    expect(prompt).toContain('P0 or P1 finding caps Overall at 3')
    expect(prompt).toContain('Architecture/integration')
    expect(prompt).toContain('Repository/release hygiene')
    expect(prompt).toContain('## Findings')
    expect(prompt).toContain('## Intended outcome')
    expect(prompt).toContain('## Quality scorecard')
    expect(prompt).toContain('## Validation')
    expect(prompt).toContain('all ten numbered hard checks')
    expect(prompt).toContain('Do not include a `## Review summary` section')
  })

  it('makes missing descriptions and focus explicit', () => {
    const prompt = worktreeCodeReviewPrompt({
      key: 'W-0001',
      title: 'Investigate',
      description: '',
      repository: 'example/api',
      sourceRunId: 2,
      baseSha: 'def456',
    })
    expect(prompt).toContain('Not provided.')
    expect(prompt).toContain('No additional review focus was supplied.')
  })
})
