import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('node:fs', () => ({ existsSync: (path: string) => path.includes('available') }))

describe('codexTurnInput', () => {
  it('embeds available local images once alongside the text prompt', async () => {
    const { codexTurnInput } = await import('./input')
    const path = '/data/prompt-images/available.png'
    expect(codexTurnInput(`Compare this\n![screen](${path})\n![duplicate](${path})`)).toEqual([
      {
        type: 'text',
        text: `Compare this\n![screen](${path})\n![duplicate](${path})`,
        text_elements: [],
      },
      { type: 'localImage', path },
    ])
  })

  it('keeps missing image references in text without sending an invalid image item', async () => {
    const { codexTurnInput } = await import('./input')
    expect(codexTurnInput('![missing](/data/prompt-images/missing.png)')).toHaveLength(1)
  })
})
