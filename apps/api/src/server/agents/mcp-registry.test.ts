import { describe, expect, it, vi } from 'vite-plus/test'
import { parseMcpRegistryResponse, searchMcpRegistry } from './mcp-registry.ts'

describe('official MCP registry search', () => {
  it('maps remote SSE and npm stdio entries into reviewable configurations', () => {
    expect(
      parseMcpRegistryResponse({
        servers: [
          {
            server: {
              name: 'io.example/remote',
              title: 'Remote',
              description: 'Remote tools',
              version: '1.0.0',
              remotes: [{ type: 'sse', url: 'https://example.test/sse' }],
            },
          },
          {
            server: {
              name: 'io.example/local',
              description: 'Local tools',
              version: '2.0.0',
              packages: [
                {
                  registryType: 'npm',
                  identifier: '@example/mcp',
                  version: '2.0.0',
                  transport: { type: 'stdio' },
                  environmentVariables: [{ name: 'TOKEN', isRequired: true, isSecret: true }],
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ id: 'io.example/remote', transport: 'sse', url: 'https://example.test/sse', installable: true }),
      expect.objectContaining({
        id: 'io.example/local',
        transport: 'stdio',
        command: 'npx',
        args: ['--yes', '@example/mcp@2.0.0'],
        requiredInputs: ['TOKEN (secret)'],
      }),
    ])
  })

  it('queries only the fixed official registry endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ servers: [] })))
    await searchMcpRegistry(' github ', fetcher)
    const url = new URL(String(fetcher.mock.calls[0]![0]))
    expect(url.origin).toBe('https://registry.modelcontextprotocol.io')
    expect(url.searchParams.get('search')).toBe('github')
    expect(url.searchParams.get('version')).toBe('latest')
  })
})
