import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { serverArtifacts, serverBundleEntries } from './bin/artifacts.mjs'

const serverRoot = resolve(import.meta.dirname)
const repositoryRoot = resolve(serverRoot, '../..')

describe('server release artifacts', () => {
  it('embeds the VertexADE form MCP bundle in the npm server', async () => {
    expect(serverBundleEntries).toContain(serverArtifacts.subagentMcp)
    await expect(access(resolve(repositoryRoot, 'apps/desktop/dist', serverArtifacts.subagentMcp))).resolves.toBeUndefined()
  })

  it('launches the API with the embedded form MCP path', async () => {
    const launcher = await readFile(resolve(serverRoot, 'bin/vertexade.mjs'), 'utf8')
    expect(launcher).toContain('VERTEXADE_SUBAGENT_MCP_SCRIPT:')
    expect(launcher).toContain('serverArtifacts.subagentMcp')
  })
})
