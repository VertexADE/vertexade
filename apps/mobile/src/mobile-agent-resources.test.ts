import { addMobileSkill, loadMobileAgentResources, saveMobileCustomAgent, saveMobileMcpServer, searchMobileMcpRegistry } from './mobile-agent-resources'
import { createMobilePlatformClient } from './platform-service'

jest.mock('./platform-service', () => ({ createMobilePlatformClient: jest.fn() }))

const request = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(createMobilePlatformClient).mockReturnValue({ request } as never)
})

test('loads resources from the owning backend', async () => {
  request.mockResolvedValue({ skills: [{ id: 'skill-1' }], mcpServers: [], profiles: [] })
  await expect(loadMobileAgentResources('https://server.test', 'primary')).resolves.toMatchObject({ skills: [{ id: 'skill-1' }] })
  expect(createMobilePlatformClient).toHaveBeenCalledWith('https://server.test', 'primary')
})

test('writes skills, MCP servers, and custom agents through the server resource contract', async () => {
  request.mockResolvedValue({})
  await addMobileSkill('https://server.test', 'primary', 'owner/repo', 'review')
  await saveMobileMcpServer('https://server.test', 'primary', { name: 'Docs', endpoint: 'https://mcp.test/sse', transport: 'sse' })
  await saveMobileCustomAgent('https://server.test', 'primary', { name: 'Reviewer', description: '', agentId: 'codex', model: '', reasoningEffort: '', promptPrefix: '', skillIds: [], mcpServerIds: [] })
  expect(request).toHaveBeenNthCalledWith(1, '/api/agent-resources/skills', expect.objectContaining({ method: 'POST' }))
  expect(request).toHaveBeenNthCalledWith(2, '/api/agent-resources/mcp', expect.objectContaining({ body: expect.stringContaining('https://mcp.test/sse') }))
  expect(request).toHaveBeenNthCalledWith(3, '/api/agent-resources/profiles', expect.objectContaining({ body: expect.stringContaining('Reviewer') }))
})

test('searches the official MCP registry through the owning backend', async () => {
  request.mockResolvedValue({ results: [{ id: 'io.example/tools', name: 'Tools', installable: true }] })
  await expect(searchMobileMcpRegistry('https://server.test', 'primary', 'tools')).resolves.toEqual([
    expect.objectContaining({ id: 'io.example/tools' }),
  ])
  expect(request).toHaveBeenCalledWith('/api/agent-resources/mcp/search?query=tools')
})
