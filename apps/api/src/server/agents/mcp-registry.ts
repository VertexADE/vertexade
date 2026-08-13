const registryUrl = 'https://registry.modelcontextprotocol.io/v0.1/servers'

type RegistryArgument = { name?: unknown; value?: unknown; default?: unknown; isRequired?: unknown; isSecret?: unknown }
type RegistryPackage = {
  registryType?: unknown
  identifier?: unknown
  version?: unknown
  runtimeHint?: unknown
  runtimeArguments?: unknown
  packageArguments?: unknown
  environmentVariables?: unknown
  transport?: { type?: unknown }
}
type RegistryRemote = { type?: unknown; url?: unknown; headers?: unknown }

export type McpRegistryResult = {
  id: string
  name: string
  description: string
  version: string
  repositoryUrl: string
  installable: boolean
  transport?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  requiredInputs: string[]
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function argumentsFrom(value: unknown) {
  const requiredInputs: string[] = []
  const args = (Array.isArray(value) ? value : []).flatMap((candidate) => {
    const argument = candidate && typeof candidate === 'object' ? (candidate as RegistryArgument) : {}
    const name = text(argument.name, 100)
    const resolved = text(argument.value, 2_000) || text(argument.default, 2_000)
    if (!resolved && argument.isRequired === true) requiredInputs.push(name || 'Required argument')
    return resolved ? [...(name ? [name] : []), resolved] : []
  })
  return { args, requiredInputs }
}

function packageLaunch(value: RegistryPackage) {
  if (value.transport?.type !== 'stdio') return null
  const registryType = text(value.registryType, 50)
  const identifier = text(value.identifier, 1_000)
  const version = text(value.version, 200)
  if (!identifier) return null
  const runtime = argumentsFrom(value.runtimeArguments)
  const packageArguments = argumentsFrom(value.packageArguments)
  const environment = (Array.isArray(value.environmentVariables) ? value.environmentVariables : [])
    .map((candidate) => (candidate && typeof candidate === 'object' ? (candidate as RegistryArgument) : {}))
    .filter((input) => input.isRequired === true && !text(input.value) && !text(input.default))
    .map((input) => `${text(input.name, 100) || 'Environment variable'}${input.isSecret === true ? ' (secret)' : ''}`)
  if (registryType === 'npm')
    return {
      command: text(value.runtimeHint, 100) || 'npx',
      args: [...runtime.args, '--yes', `${identifier}${version ? `@${version}` : ''}`, ...packageArguments.args],
      requiredInputs: [...runtime.requiredInputs, ...packageArguments.requiredInputs, ...environment],
    }
  if (registryType === 'pypi')
    return {
      command: text(value.runtimeHint, 100) || 'uvx',
      args: [...runtime.args, `${identifier}${version ? `==${version}` : ''}`, ...packageArguments.args],
      requiredInputs: [...runtime.requiredInputs, ...packageArguments.requiredInputs, ...environment],
    }
  return null
}

export function parseMcpRegistryResponse(payload: unknown): McpRegistryResult[] {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  return (Array.isArray(root.servers) ? root.servers : []).flatMap((candidate) => {
    const entry = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {}
    const server = entry.server && typeof entry.server === 'object' ? (entry.server as Record<string, unknown>) : {}
    const id = text(server.name, 200)
    if (!id) return []
    const remote = (Array.isArray(server.remotes) ? server.remotes : []).find((item) => {
      const value = item && typeof item === 'object' ? (item as RegistryRemote) : {}
      return value.type === 'sse' && Boolean(text(value.url, 4_000))
    }) as RegistryRemote | undefined
    const launch = (Array.isArray(server.packages) ? server.packages : [])
      .map((item) => packageLaunch(item && typeof item === 'object' ? (item as RegistryPackage) : {}))
      .find(Boolean)
    const configuration = remote
      ? { transport: 'sse' as const, url: text(remote.url, 4_000), requiredInputs: [] as string[] }
      : launch
        ? { transport: 'stdio' as const, ...launch }
        : null
    const repository = server.repository && typeof server.repository === 'object' ? (server.repository as Record<string, unknown>) : {}
    return [
      {
        id,
        name: text(server.title, 200) || id,
        description: text(server.description),
        version: text(server.version, 200),
        repositoryUrl: text(repository.url, 4_000),
        installable: Boolean(configuration),
        ...(configuration || { requiredInputs: [] }),
      },
    ]
  })
}

export async function searchMcpRegistry(query: string, fetcher: typeof fetch = fetch): Promise<McpRegistryResult[]> {
  const search = query.trim().slice(0, 200)
  if (!search) return []
  const url = new URL(registryUrl)
  url.searchParams.set('search', search)
  url.searchParams.set('version', 'latest')
  url.searchParams.set('limit', '30')
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Official MCP Registry returned ${response.status}`)
  return parseMcpRegistryResponse(await response.json())
}
