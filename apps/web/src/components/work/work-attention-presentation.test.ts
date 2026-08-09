import { describe, expect, it } from 'vite-plus/test'
import { attentionRetryLabel, workAttentionPresentation } from './work-attention-presentation'

describe('workAttentionPresentation', () => {
  it('turns repository internals into a calm recovery instruction', () => {
    const raw = 'From github.com:example/repo\nerror: fetching ref refs/remotes/origin/main failed: incorrect old value provided'
    expect(workAttentionPresentation({ attention: raw })).toEqual({
      kind: 'repository_sync',
      title: 'Repository sync needs a retry',
      summary: 'The repository changed while VertexADE was refreshing it. Retry the agent from the existing Work item.',
      technicalDetails: raw,
    })
    expect(attentionRetryLabel({ kind: 'pr_review' }, 'repository_sync')).toBe('Retry review')
  })

  it('separates cleanup failures from the outcome itself', () => {
    expect(
      workAttentionPresentation({ attention: 'Run #143: Refusing to remove a log outside the dashboard logs directory' }),
    ).toMatchObject({
      kind: 'cleanup',
      title: 'Local cleanup needs attention',
    })
  })

  it('keeps short unknown messages readable without inventing context', () => {
    expect(workAttentionPresentation({ attention: 'Needs an owner decision' })).toEqual({
      kind: 'general',
      title: 'Work needs your attention',
      summary: 'Needs an owner decision',
      technicalDetails: null,
    })
  })
})
