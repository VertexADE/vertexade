import { describe, expect, it } from 'vite-plus/test'
import { appendPromptImages } from './prompt-images'

describe('appendPromptImages', () => {
  it('embeds uploaded images below the written prompt', () => {
    expect(appendPromptImages('Check this layout', [{ name: 'screen[1].png', url: '/api/prompt-images/id.png' }])).toBe(
      'Check this layout\n\nAttached reference images:\n![screen-1-.png](/api/prompt-images/id.png)',
    )
  })

  it('allows an image-only prompt', () => {
    expect(appendPromptImages('', [{ name: 'screen.png', url: '/api/prompt-images/id.png' }])).toContain('Attached reference images:')
  })

  it('does not repeat the attachment heading across multiple pastes', () => {
    const first = appendPromptImages('Check this', [{ name: 'one.png', url: '/api/prompt-images/one.png' }])
    expect(
      appendPromptImages(first, [{ name: 'two.png', url: '/api/prompt-images/two.png' }]).match(/Attached reference images:/g),
    ).toHaveLength(1)
  })
})
