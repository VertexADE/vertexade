import { describe, expect, it } from 'vite-plus/test'
import { activityPreview } from './activity-preview'

describe('activityPreview', () => {
  it('turns review Markdown into a concise plain-text preview', () => {
    expect(activityPreview('## Review summary\n\nThis flips `MODE` from **off** to [real](https://example.test).')).toBe(
      'This flips MODE from off to real.',
    )
  })

  it('provides a useful empty state', () => {
    expect(activityPreview()).toBe('No activity recorded')
  })

  it('keeps previews concise without cutting through a word', () => {
    const result = activityPreview(
      'The agent completed the requested implementation and verified the first behavior. It then wrote a very long technical appendix that belongs in the full run rather than the attention summary.',
      90,
    )

    expect(result).toBe('The agent completed the requested implementation and verified the first behavior.…')
  })
})
