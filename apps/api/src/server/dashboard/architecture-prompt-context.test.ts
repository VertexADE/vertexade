import { describe, expect, it } from 'vite-plus/test'
import { architecturePromptContext } from './read-model.ts'

describe('architecturePromptContext', () => {
  it('accepts bounded current-head citations and delimits them as untrusted context', () => {
    const revision = 'a'.repeat(40)
    const result = architecturePromptContext(
      {
        architecture_context: {
          packetId: 7,
          digest: 'b'.repeat(64),
          revision,
          facts: [
            {
              key: 'package:api',
              label: 'API',
              summary: 'Owns HTTP boundaries',
              path: 'apps/api',
              reason: 'Changed API route',
              citations: [{ path: 'apps/api/package.json', startLine: 1, endLine: 10, digest: 'c'.repeat(64) }],
            },
          ],
        },
      },
      { head_sha: revision },
    )
    expect(result).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({ packetId: 7, revision }),
        prompt: expect.stringContaining('<untrusted_architecture_context>'),
      }),
    )
  })

  it('rejects a packet captured for another pull-request head', () => {
    expect(
      architecturePromptContext(
        { architecture_context: { packetId: 1, digest: 'b'.repeat(64), revision: 'a'.repeat(40), facts: [] } },
        { head_sha: 'c'.repeat(40) },
      ),
    ).toEqual({ error: 'Architecture context does not match the current pull-request head', status: 409 })
  })
})
