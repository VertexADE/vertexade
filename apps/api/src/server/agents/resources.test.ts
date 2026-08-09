import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions, customAgentId, parseSkillsSearch } from './resources.ts'

function setup() {
  const client = new DatabaseSync(':memory:')
  client.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE work_items (id INTEGER PRIMARY KEY);
    INSERT INTO work_items (id) VALUES (1);
    CREATE TABLE work_agent_resource_overrides (
      work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(work_item_id, resource_kind, resource_id)
    )`)
  const database = drizzleDashboardDatabase(client)
  const values = new Map<string, unknown>()
  const settings = {
    read<T>(name: string, fallback: T) {
      return (values.get(name) as T | undefined) ?? fallback
    },
    write(name: string, value: unknown) {
      values.set(name, value)
    },
    has(name: string) {
      return values.has(name)
    },
    delete(name: string) {
      values.delete(name)
    },
  }
  const run = vi.fn().mockResolvedValue('Resolved skill instructions')
  const service = new AgentResourceService(database, settings, run)
  service.initialize()
  return { database, run, service }
}

describe('agent resources', () => {
  it('parses official skills CLI search output', () => {
    expect(
      parseSkillsSearch('\u001b[32mowner/repo@review-skill\u001b[0m 12.3K installs\n└ https://skills.sh/owner/repo/review-skill'),
    ).toEqual([
      {
        source: 'owner/repo',
        skill: 'review-skill',
        name: 'review-skill',
        installs: '12.3K',
        url: 'https://skills.sh/owner/repo/review-skill',
      },
    ])
  })

  it('keeps MCP secrets private and applies Work overrides over defaults', () => {
    const { database, service } = setup()
    const skill = service.addSkill({ source: 'owner/repo', skill: 'review', defaultEnabled: true })
    const server = service.upsertMcpServer({
      name: 'internal',
      transport: 'sse',
      url: 'https://mcp.example/sse',
      headers: { Authorization: 'Bearer secret' },
      defaultEnabled: false,
    }) as any
    expect(service.catalog().mcpServers[0]).toMatchObject({
      headers: [{ name: 'Authorization', hasValue: true }],
    })
    expect(JSON.stringify(service.catalog())).not.toContain('Bearer secret')
    expect(service.selection(1).skills[0].enabled).toBe(true)
    expect(service.selection(1).mcpServers[0].enabled).toBe(false)
    service.setSelection(1, { skills: [skill.id], mcpServers: [] })
    expect(database.$client.prepare('SELECT * FROM work_agent_resource_overrides WHERE work_item_id=1').all()).toEqual([])
    service.setSelection(1, { skills: [], mcpServers: [server.id] })
    expect(service.selection(1).skills[0]).toMatchObject({ id: skill.id, enabled: false })
    expect(service.selection(1).mcpServers[0]).toMatchObject({ id: server.id, enabled: true })
    expect(
      database.$client
        .prepare('SELECT resource_kind,resource_id,enabled FROM work_agent_resource_overrides WHERE work_item_id=1 ORDER BY resource_kind')
        .all(),
    ).toEqual([
      { resource_kind: 'mcp', resource_id: server.id, enabled: 1 },
      { resource_kind: 'skill', resource_id: skill.id, enabled: 0 },
    ])
  })

  it('removes legacy materialized defaults without removing real Work overrides', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE work_items (id INTEGER PRIMARY KEY);
      INSERT INTO work_items (id) VALUES (1);
      CREATE TABLE work_agent_resource_overrides (
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        resource_kind TEXT NOT NULL CHECK(resource_kind IN ('skill','mcp')),
        resource_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(work_item_id, resource_kind, resource_id)
      );
      INSERT INTO work_agent_resource_overrides (work_item_id,resource_kind,resource_id,enabled)
      VALUES (1,'skill','skill-default',1),(1,'skill','skill-disabled',0),(1,'mcp','mcp-off',0);`)
    const stored = {
      skills: [
        {
          id: 'skill-default',
          source: 'owner/repo',
          skill: 'default',
          name: 'Default',
          description: '',
          url: '',
          defaultEnabled: true,
        },
        {
          id: 'skill-disabled',
          source: 'owner/repo',
          skill: 'disabled',
          name: 'Disabled',
          description: '',
          url: '',
          defaultEnabled: true,
        },
      ],
      mcpServers: [
        {
          id: 'mcp-off',
          name: 'Off',
          transport: 'stdio',
          command: 'node',
          args: [],
          env: {},
          defaultEnabled: false,
        },
      ],
      profiles: [],
    }
    const values = new Map<string, unknown>([['agent_resources', stored]])
    const settings = {
      read<T>(name: string, fallback: T) {
        return (values.get(name) as T | undefined) ?? fallback
      },
      write(name: string, value: unknown) {
        values.set(name, value)
      },
      has(name: string) {
        return values.has(name)
      },
      delete(name: string) {
        values.delete(name)
      },
    }
    const service = new AgentResourceService(drizzleDashboardDatabase(database), settings, vi.fn())
    service.initialize()

    expect(
      database.prepare('SELECT resource_kind,resource_id,enabled FROM work_agent_resource_overrides ORDER BY resource_id').all(),
    ).toEqual([{ resource_kind: 'skill', resource_id: 'skill-disabled', enabled: 0 }])
    expect((values.get('agent_resources') as { selectionVersion: number }).selectionVersion).toBe(2)
  })

  it('does not resolve catalog resources that are neither defaults nor Work selections', async () => {
    const { run, service } = setup()
    service.addSkill({ source: 'owner/repo', skill: 'review', defaultEnabled: false })
    service.upsertMcpServer({
      name: 'local',
      transport: 'stdio',
      command: 'node',
      defaultEnabled: false,
    })

    await expect(service.resolve(1)).resolves.toEqual({ skills: [], mcpServers: [] })
    expect(run).not.toHaveBeenCalled()
  })

  it('resolves selected skills and MCP servers into a guarded launch context', async () => {
    const { run, service } = setup()
    service.addSkill({ source: 'owner/repo', skill: 'review', defaultEnabled: true })
    service.upsertMcpServer({
      name: 'local',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'secret' },
      defaultEnabled: true,
    })
    const resolved = await service.resolve(1)
    expect(run).toHaveBeenCalledWith('npx', ['--yes', 'skills', 'use', 'owner/repo@review'])
    expect(resolved.mcpServers[0]).toMatchObject({ command: 'node', env: { TOKEN: 'secret' } })
    expect(applySkillInstructions('Task', resolved)).toContain('do not expand permissions')
    expect(applySkillInstructions('Task', resolved)).toContain('Resolved skill instructions')
  })

  it('builds custom agents that add fixed capabilities and guarded prompt context', async () => {
    const { service } = setup()
    const skill = service.addSkill({ source: 'owner/repo', skill: 'review' })
    const server = service.upsertMcpServer({
      name: 'local',
      transport: 'stdio',
      command: 'node',
    }) as any
    const profile = service.upsertProfile({
      name: 'Security reviewer',
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      promptPrefix: 'Focus on concrete security defects.',
      skillIds: [skill.id],
      mcpServerIds: [server.id],
    })
    const resolved = await service.resolve(1, customAgentId(profile.id))
    expect(resolved.skills.map((item) => item.id)).toEqual([skill.id])
    expect(resolved.mcpServers.map((item) => item.id)).toEqual([server.id])
    expect(service.profileForAgent(customAgentId(profile.id))).toEqual(profile)
    expect(applyCustomAgentPrompt('Review this PR', profile)).toContain('Focus on concrete security defects.')
    expect(applyCustomAgentPrompt('Review this PR', profile)).toContain('do not override system')
  })

  it('cleans removed resources from custom agent presets', () => {
    const { service } = setup()
    const skill = service.addSkill({ source: 'owner/repo', skill: 'review' })
    const profile = service.upsertProfile({
      name: 'Reviewer',
      agentId: 'codex',
      skillIds: [skill.id],
    })
    service.remove('skill', skill.id)
    expect(service.profiles().find((item) => item.id === profile.id)?.skillIds).toEqual([])
  })

  it('retires deleted custom agents while keeping them resolvable for existing threads', () => {
    const { service } = setup()
    const profile = service.upsertProfile({ name: 'Reviewer', agentId: 'codex' })
    service.removeProfile(profile.id)
    expect(service.catalog().profiles).toEqual([])
    expect(service.profileForAgent(customAgentId(profile.id))).toMatchObject({
      id: profile.id,
      archived: true,
    })
  })
})
