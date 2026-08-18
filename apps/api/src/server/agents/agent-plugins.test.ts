import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { AGENT_PLUGIN_MCP_SCHEMA, AGENT_PLUGIN_SCHEMA, loadAgentPlugin, readPluginSkill } from './agent-plugins.ts'

const temporaryDirectories: string[] = []

async function temporaryDirectory(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `vertexade-${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), 'utf8')
}

async function plugin(name = 'example-plugin') {
  const directory = await temporaryDirectory('agent-plugin')
  await json(join(directory, 'plugin.json'), {
    $schema: AGENT_PLUGIN_SCHEMA,
    name,
    version: '1.2.3',
    description: 'Portable agent capabilities.',
    repository: 'https://github.com/example/plugin',
  })
  return directory
}

async function skill(root: string, name: string, description = `Use ${name} for test tasks.`) {
  const directory = join(root, 'skills', name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nFollow ${name}.\n`, 'utf8')
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Agent Plugins 1.0 loader', () => {
  it('loads a single portable plugin from a marketplace-style repository root', async () => {
    const repository = await temporaryDirectory('agent-plugin-repository')
    const root = join(repository, 'plugins', 'nemeda-agent-kit')
    await mkdir(root, { recursive: true })
    await json(join(root, 'plugin.json'), {
      $schema: AGENT_PLUGIN_SCHEMA,
      name: 'nemeda-agent-kit',
      version: '0.2.3',
      description: 'Portable methodology, tools, and repository context for AI coding agents.',
    })
    await skill(root, 'workspace-context')
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts', 'mcp-server.mjs'), '')
    await json(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        'workspace-context': {
          type: 'stdio',
          command: 'node',
          args: ['${PLUGIN_ROOT}/scripts/mcp-server.mjs'],
        },
      },
    })

    const loaded = await loadAgentPlugin(repository, await temporaryDirectory('agent-plugin-data'))

    expect(loaded.plugin).toMatchObject({ name: 'nemeda-agent-kit', root: expect.stringContaining('/plugins/nemeda-agent-kit') })
    expect(loaded.skills).toHaveLength(1)
    expect(loaded.mcpServers).toEqual([
      expect.objectContaining({
        name: 'nemeda-agent-kit/workspace-context',
        args: [join(loaded.plugin.root, 'scripts', 'mcp-server.mjs')],
        cwd: loaded.plugin.root,
      }),
    ])
  })

  it('requires an exact plugin directory when a repository contains multiple portable plugins', async () => {
    const repository = await temporaryDirectory('agent-plugin-repository')
    for (const name of ['first-plugin', 'second-plugin']) {
      const root = join(repository, 'plugins', name)
      await mkdir(root, { recursive: true })
      await json(join(root, 'plugin.json'), { $schema: AGENT_PLUGIN_SCHEMA, name })
    }

    await expect(loadAgentPlugin(repository, await temporaryDirectory('agent-plugin-data'))).rejects.toThrow('multiple plugins')
  })

  it('ignores unimplemented extension namespaces without validating their values', async () => {
    const root = await plugin()
    const value = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'))
    await json(join(root, 'plugin.json'), { ...value, extensions: { 'com.example.client': 'client-owned data' } })

    const loaded = await loadAgentPlugin(root, await temporaryDirectory('agent-plugin-data'))

    expect(loaded.plugin.name).toBe('example-plugin')
    expect(loaded.plugin.diagnostics).toEqual([])
  })

  it('loads valid Skills and every supported MCP transport with plugin variables', async () => {
    const root = await plugin()
    const dataRoot = await temporaryDirectory('agent-plugin-data')
    await skill(root, 'review-code')
    await mkdir(join(root, 'skills', 'nested-only', 'child'), { recursive: true })
    await writeFile(
      join(root, 'skills', 'nested-only', 'child', 'SKILL.md'),
      '---\nname: child\ndescription: Must not be found recursively.\n---\n',
    )
    await mkdir(join(root, 'skills', 'invalid'), { recursive: true })
    await writeFile(join(root, 'skills', 'invalid', 'SKILL.md'), '---\nname: wrong-name\ndescription: Invalid.\n---\n')
    await mkdir(join(root, 'bin'))
    await writeFile(join(root, 'bin', 'server'), '#!/bin/sh\n')
    await json(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        local: {
          type: 'stdio',
          command: './bin/server',
          args: ['--config', '${PLUGIN_ROOT}/config.json', '--data', '${PLUGIN_DATA}/cache'],
          env: { CONFIG: '${PLUGIN_ROOT}/config.json' },
          cwd: '${PLUGIN_DATA}/runtime',
        },
        remote: { type: 'streamable-http', url: 'https://mcp.example.test/rpc', headers: { 'X-Tenant': 'public' } },
        loopback: { type: 'sse', url: 'http://127.0.0.42/events' },
        insecure: { type: 'streamable-http', url: 'http://mcp.example.test/rpc' },
        mixed: { type: 'stdio', command: 'node', url: 'https://mcp.example.test' },
      },
    })
    const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'))
    await json(join(root, 'plugin.json'), { ...manifest, unexpected: true })

    const loaded = await loadAgentPlugin(root, dataRoot)

    expect(loaded.plugin).toMatchObject({
      name: 'example-plugin',
      version: '1.2.3',
      skillIds: [loaded.skills[0]?.id],
      mcpServerIds: loaded.mcpServers.map((server) => server.id),
    })
    expect(loaded.skills).toHaveLength(1)
    expect(loaded.skills[0]).toMatchObject({
      source: 'agent-plugin:example-plugin',
      skill: 'review-code',
      description: 'Use review-code for test tasks.',
    })
    await expect(readPluginSkill(loaded.skills[0]!)).resolves.toContain(`Skill directory: ${loaded.skills[0]!.skillDirectory}`)
    expect(loaded.mcpServers).toHaveLength(3)
    const local = loaded.mcpServers.find((server) => server.transport === 'stdio')
    expect(local).toMatchObject({
      name: 'example-plugin/local',
      command: join(loaded.plugin.root, 'bin', 'server'),
      args: ['--config', `${loaded.plugin.root}/config.json`, '--data', expect.stringContaining('/cache')],
      cwd: expect.stringMatching(/agent-plugin-[^/]+\/runtime$/),
      env: {
        CONFIG: `${loaded.plugin.root}/config.json`,
        PLUGIN_ROOT: loaded.plugin.root,
        PLUGIN_DATA: expect.stringContaining('agent-plugin-'),
      },
    })
    expect(loaded.mcpServers.map((server) => server.transport).sort()).toEqual(['http', 'sse', 'stdio'])
    expect(loaded.plugin.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', component: 'manifest', item: 'unexpected' }),
        expect.objectContaining({ component: 'skills', item: 'invalid' }),
        expect.objectContaining({ component: 'mcp', item: 'insecure' }),
        expect.objectContaining({ component: 'mcp', item: 'mixed' }),
      ]),
    )
    expect(loaded.plugin.diagnostics.some((entry) => entry.item === 'nested-only')).toBe(false)
  })

  it('keeps valid Skills when the whole MCP configuration is invalid', async () => {
    const root = await plugin()
    await skill(root, 'summarize')
    await json(join(root, 'mcp.json'), {
      $schema: 'https://agent-plugins.org/schemas/2.0.0/mcp.schema.json',
      mcpServers: { local: { type: 'stdio', command: 'node' } },
    })

    const loaded = await loadAgentPlugin(root, await temporaryDirectory('agent-plugin-data'))

    expect(loaded.skills).toHaveLength(1)
    expect(loaded.mcpServers).toEqual([])
    expect(loaded.plugin.diagnostics).toEqual([
      expect.objectContaining({ component: 'mcp', message: expect.stringContaining('supported') }),
    ])
  })

  it('isolates invalid MCP entries without weakening URL, header, environment, or path rules', async () => {
    const root = await plugin()
    await json(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        valid: { type: 'stdio', command: 'node', cwd: './missing-but-contained' },
        shell: { type: 'stdio', command: 'node server.js' },
        reserved: { type: 'stdio', command: 'node', env: { PLUGIN_ROOT: '/override' } },
        escaped: { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/../escape' },
        userinfo: { type: 'streamable-http', url: 'https://user@example.test/mcp' },
        fragment: { type: 'streamable-http', url: 'https://example.test/mcp#fragment' },
        duplicateHeaders: {
          type: 'streamable-http',
          url: 'https://example.test/mcp',
          headers: { 'X-Test': 'one', 'x-test': 'two' },
        },
        invalidHeader: { type: 'sse', url: 'https://example.test/sse', headers: { 'Bad Header': 'value' } },
      },
    })

    const loaded = await loadAgentPlugin(root, await temporaryDirectory('agent-plugin-data'))

    expect(loaded.mcpServers).toHaveLength(1)
    expect(loaded.mcpServers[0]).toMatchObject({ name: 'example-plugin/valid', cwd: join(loaded.plugin.root, 'missing-but-contained') })
    expect(loaded.plugin.diagnostics.filter((entry) => entry.component === 'mcp').map((entry) => entry.item)).toEqual([
      'shell',
      'reserved',
      'escaped',
      'userinfo',
      'fragment',
      'duplicateHeaders',
      'invalidHeader',
    ])
  })

  it('rejects a fatally invalid manifest before discovering components', async () => {
    const root = await plugin('Invalid Name')
    await skill(root, 'summarize')

    await expect(loadAgentPlugin(root, await temporaryDirectory('agent-plugin-data'))).rejects.toThrow('naming rules')
  })

  it('skips component symlinks that escape the filesystem-resolved plugin root', async () => {
    const root = await plugin()
    const outside = await temporaryDirectory('outside-plugin')
    await mkdir(join(root, 'skills'), { recursive: true })
    await skill(outside, 'escaped-skill')
    await symlink(join(outside, 'skills', 'escaped-skill'), join(root, 'skills', 'escaped-skill'))
    await mkdir(join(root, 'bin'))
    await writeFile(join(outside, 'server'), '#!/bin/sh\n')
    await symlink(join(outside, 'server'), join(root, 'bin', 'escaped-server'))
    await json(join(root, 'mcp.json'), {
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: { escaped: { type: 'stdio', command: './bin/escaped-server' } },
    })

    const loaded = await loadAgentPlugin(root, await temporaryDirectory('agent-plugin-data'))

    expect(loaded.skills).toEqual([])
    expect(loaded.mcpServers).toEqual([])
    expect(loaded.plugin.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'skills', item: 'escaped-skill', message: expect.stringContaining('outside') }),
        expect.objectContaining({ component: 'mcp', item: 'escaped', message: expect.stringContaining('outside') }),
      ]),
    )
  })
})
