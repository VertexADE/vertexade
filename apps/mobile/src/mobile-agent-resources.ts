import { createMobilePlatformClient } from './platform-service'
import { requiredRecord } from './mobile-value-parsers'

export type MobileSkill = { id: string; source: string; skill: string; name: string; description: string; url: string; defaultEnabled: boolean }
export type MobileMcpServer = { id: string; name: string; transport: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string; defaultEnabled: boolean }
export type MobileCustomAgent = { id: string; name: string; description: string; agentId: string; model: string; reasoningEffort: string; promptPrefix: string; skillIds: string[]; mcpServerIds: string[] }
export type MobileAgentResourceCatalog = { skills: MobileSkill[]; mcpServers: MobileMcpServer[]; profiles: MobileCustomAgent[] }
export type MobileMcpRegistryResult = { id: string; name: string; description: string; version: string; repositoryUrl: string; installable: boolean; transport?: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string; requiredInputs: string[] }

function client(serviceUrl: string, backendId: string) {
  return createMobilePlatformClient(serviceUrl, backendId)
}

export async function loadMobileAgentResources(serviceUrl: string, backendId: string): Promise<MobileAgentResourceCatalog> {
  const value = requiredRecord(await client(serviceUrl, backendId).request('/api/agent-resources'), 'VertexADE returned invalid agent resources')
  return {
    skills: Array.isArray(value.skills) ? value.skills as MobileSkill[] : [],
    mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers as MobileMcpServer[] : [],
    profiles: Array.isArray(value.profiles) ? value.profiles as MobileCustomAgent[] : [],
  }
}

export async function addMobileSkill(serviceUrl: string, backendId: string, source: string, skill: string) {
  const name = skill.split('/').at(-1) || skill
  await request(serviceUrl, backendId, '/api/agent-resources/skills', 'POST', { source, skill, name, description: '', url: `https://skills.sh/${source}/${skill}`, defaultEnabled: false })
}

export async function searchMobileMcpRegistry(serviceUrl: string, backendId: string, query: string): Promise<MobileMcpRegistryResult[]> {
  const value = requiredRecord(await client(serviceUrl, backendId).request(`/api/agent-resources/mcp/search?query=${encodeURIComponent(query.trim())}`), 'VertexADE returned invalid MCP registry results')
  return Array.isArray(value.results) ? value.results as MobileMcpRegistryResult[] : []
}

export async function saveMobileMcpServer(serviceUrl: string, backendId: string, input: { name: string; transport: 'stdio' | 'sse'; endpoint: string; args?: string[] }) {
  await request(serviceUrl, backendId, '/api/agent-resources/mcp', 'POST', input.transport === 'stdio'
    ? { name: input.name, transport: 'stdio', command: input.endpoint, args: input.args || [], env: {}, defaultEnabled: false }
    : { name: input.name, transport: 'sse', url: input.endpoint, headers: {}, defaultEnabled: false })
}

export async function saveMobileCustomAgent(serviceUrl: string, backendId: string, profile: Omit<MobileCustomAgent, 'id'> & { id?: string }) {
  await request(serviceUrl, backendId, '/api/agent-resources/profiles', 'POST', profile)
}

export async function setMobileResourceDefault(serviceUrl: string, backendId: string, kind: 'skill' | 'mcp', id: string, enabled: boolean) {
  await request(serviceUrl, backendId, `/api/agent-resources/${kind}/${encodeURIComponent(id)}/default`, 'POST', { enabled })
}

export async function removeMobileAgentResource(serviceUrl: string, backendId: string, kind: 'skill' | 'mcp' | 'profiles', id: string) {
  await request(serviceUrl, backendId, `/api/agent-resources/${kind}/${encodeURIComponent(id)}`, 'DELETE')
}

async function request(serviceUrl: string, backendId: string, path: string, method: string, body?: unknown) {
  await client(serviceUrl, backendId).request(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}
