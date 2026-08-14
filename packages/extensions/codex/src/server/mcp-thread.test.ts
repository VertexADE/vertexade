import { describe, expect, it } from 'vite-plus/test'
import { resumedThreadNeedsMcpMigration } from './mcp-thread.ts'

describe('resumed Codex MCP compatibility', () => {
  it('migrates an older thread whose VertexADE server has no form tool', () => {
    expect(resumedThreadNeedsMcpMigration('vertexade-subagents', [])).toBe(true)
    expect(resumedThreadNeedsMcpMigration('vertexade-subagents', [{ name: 'vertexade-subagents', tools: {} }])).toBe(true)
  })

  it('keeps a thread that already exposes the current form tool', () => {
    expect(
      resumedThreadNeedsMcpMigration('vertexade-subagents', [
        { name: 'vertexade-subagents', tools: { form: { description: 'Ask with a form' } } },
      ]),
    ).toBe(false)
  })

  it('does not migrate when VertexADE has no required built-in server', () => {
    expect(resumedThreadNeedsMcpMigration(null, [])).toBe(false)
  })
})
