import { describe, expect, it } from 'vite-plus/test'
import { decodePromptImage, localizePromptImages, promptImageFileName } from './prompt-images'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64')

describe('prompt images', () => {
  it('validates image data and sanitizes its display name', () => {
    expect(
      decodePromptImage(
        {
          filename: '../screen[1].png',
          mediaType: 'image/png',
          url: `data:image/png;base64,${png}`,
        },
        0,
      ),
    ).toMatchObject({
      extension: 'png',
      mediaType: 'image/png',
      name: 'screen-1-.png',
    })
  })

  it('rejects content whose signature does not match its media type', () => {
    expect(() =>
      decodePromptImage(
        {
          mediaType: 'image/png',
          url: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
        },
        0,
      ),
    ).toThrow('do not match')
  })

  it('localizes only generated prompt image links', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000.png'
    expect(localizePromptImages(`![screen](/api/prompt-images/${id})`, '/data/images')).toBe(`![screen](/data/images/${id})`)
    expect(promptImageFileName(`/api/prompt-images/${id}`)).toBe(id)
    expect(promptImageFileName('/api/prompt-images/../../secret.png')).toBeNull()
  })
})
