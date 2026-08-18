import { createHash } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import { access, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentMcpServer, AgentPlugin, AgentPluginDiagnostic, AgentSkill } from '@vertexade/platform-contracts'
import { parseDocument } from 'yaml'

export const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const AGENT_PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

const maximumFileBytes = 1_000_000
const manifestFields = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
])
const skillName = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const pluginName = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export type AgentPluginStoredSkill = AgentSkill & { pluginRoot: string; skillFile: string; skillDirectory: string }
export type LoadedAgentPlugin = { plugin: AgentPlugin; skills: AgentPluginStoredSkill[]; mcpServers: AgentMcpServer[] }

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function diagnostic(
  component: AgentPluginDiagnostic['component'],
  message: string,
  item?: string,
  severity: AgentPluginDiagnostic['severity'] = 'error',
): AgentPluginDiagnostic {
  const safeItem = item?.replace(/[\u0000-\u001f\u007f]/g, '�').slice(0, 1_000)
  return { severity, component, ...(safeItem ? { item: safeItem } : {}), message: message.slice(0, 4_000) }
}

function id(prefix: 'agent-plugin' | 'skill' | 'mcp', identity: string) {
  return `${prefix}-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

function pathWithin(root: string, target: string) {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function boundedFile(path: string, label: string) {
  const details = await stat(path)
  if (!details.isFile()) throw new Error(`${label} must be a regular file`)
  if (details.size > maximumFileBytes) throw new Error(`${label} exceeds the 1 MB limit`)
  return readFile(path, 'utf8')
}

async function containedPath(root: string, path: string, label: string) {
  const resolved = await realpath(path)
  if (!pathWithin(root, resolved)) throw new Error(`${label} resolves outside the plugin root`)
  return resolved
}

function missingPath(error: unknown) {
  return object(error) && error.code === 'ENOENT'
}

async function readableDirectory(inputPath: string) {
  try {
    const directory = await realpath(resolve(inputPath))
    if (!(await stat(directory)).isDirectory()) throw new Error('Agent Plugin path must resolve to a directory')
    return directory
  } catch (error) {
    if (error instanceof Error && error.message === 'Agent Plugin path must resolve to a directory') throw error
    throw new Error('Agent Plugin directory could not be read', { cause: error })
  }
}

async function trustedPluginPath(inputPath: string, trustedRoots: string[]) {
  const directory = await readableDirectory(inputPath)
  for (const configuredRoot of trustedRoots) {
    try {
      const root = await realpath(resolve(configuredRoot))
      if (pathWithin(root, directory)) return directory
    } catch (error) {
      if (!missingPath(error)) throw error
    }
  }
  throw new Error('Agent Plugin path is outside the trusted roots configured by VERTEXADE_AGENT_PLUGIN_ROOTS')
}

async function optionalPluginDirectory(sourceRoot: string, candidate: string, label: string) {
  try {
    const directory = await containedPath(sourceRoot, candidate, label)
    if (!(await stat(directory)).isDirectory()) return null
    const pluginManifest = await containedPath(sourceRoot, join(directory, 'plugin.json'), `${label} plugin.json`)
    return (await stat(pluginManifest)).isFile() ? directory : null
  } catch (error) {
    if (!missingPath(error)) throw error
    return null
  }
}

async function repositoryPluginDirectories(sourceRoot: string) {
  const pluginsDirectory = join(sourceRoot, 'plugins')
  let entries: Dirent[] = []
  try {
    const resolvedPluginsDirectory = await containedPath(sourceRoot, pluginsDirectory, 'plugins')
    if (!(await stat(resolvedPluginsDirectory)).isDirectory()) throw new Error('plugins must resolve to a directory')
    entries = await readdir(resolvedPluginsDirectory, { withFileTypes: true })
  } catch (error) {
    if (!missingPath(error)) throw error
  }
  const candidates = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => optionalPluginDirectory(sourceRoot, join(pluginsDirectory, entry.name), `Plugin ${entry.name}`)),
  )
  return candidates.filter((candidate): candidate is string => candidate !== null)
}

async function pluginRoot(inputPath: string) {
  const sourceRoot = await readableDirectory(inputPath)
  if (await optionalPluginDirectory(sourceRoot, sourceRoot, 'Plugin root')) return sourceRoot
  const candidates = await repositoryPluginDirectories(sourceRoot)
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1)
    throw new Error('Agent Plugin repository contains multiple plugins; select the specific directory under plugins/')
  throw new Error('Agent Plugin root must contain plugin.json or exactly one plugins/*/plugin.json')
}

async function nearestExistingAncestor(candidate: string) {
  let ancestor = candidate
  while (true) {
    try {
      return { ancestor, resolved: await realpath(ancestor) }
    } catch (error) {
      if (!missingPath(error)) throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      ancestor = parent
    }
  }
}

function assertContainedDirectoryProjection(base: string, existing: string, projected: string) {
  if (!pathWithin(base, existing) || !pathWithin(base, projected)) throw new Error('cwd resolves outside its allowed plugin directory')
}

async function materializeContainedDirectory(projected: string, exists: boolean, create: boolean) {
  if (create && !exists) await mkdir(projected, { recursive: true })
  if (!exists && !create) return projected
  const result = await realpath(projected)
  if (!(await stat(result)).isDirectory()) throw new Error('cwd must resolve to a contained directory')
  return result
}

async function containedDirectory(base: string, candidate: string, create: boolean) {
  if (!pathWithin(base, candidate)) throw new Error('cwd resolves outside its allowed plugin directory')
  const existing = await nearestExistingAncestor(candidate)
  const projected = resolve(existing.resolved, relative(existing.ancestor, candidate))
  assertContainedDirectoryProjection(base, existing.resolved, projected)
  const exists = existing.ancestor === candidate
  const result = await materializeContainedDirectory(projected, exists, create)
  if (!pathWithin(base, result)) throw new Error('cwd resolves outside its allowed plugin directory')
  return result
}

async function jsonFile(root: string, path: string, label: string) {
  const resolved = await containedPath(root, path, label)
  let parsed: unknown
  try {
    parsed = JSON.parse(await boundedFile(resolved, label))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON`)
    throw error
  }
  if (!object(parsed)) throw new Error(`${label} must contain a JSON object`)
  return parsed
}

function string(value: unknown, field: string, required = false) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || (required && !value.length)) throw new Error(`${field} must be ${required ? 'a non-empty' : 'a'} string`)
  return value
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${field} must be an array of strings`)
  return value
}

function stringObject(value: unknown, field: string) {
  if (value === undefined) return {}
  if (!object(value) || Object.values(value).some((entry) => typeof entry !== 'string'))
    throw new Error(`${field} must be an object of strings`)
  return value as Record<string, string>
}

function manifestAuthor(value: unknown) {
  if (value === undefined) return
  if (!object(value)) throw new Error('plugin.json author must be an object')
  if (Object.keys(value).some((field) => !['name', 'email', 'url'].includes(field)))
    throw new Error('plugin.json author contains an unknown field')
  for (const [field, entry] of Object.entries(value)) string(entry, `plugin.json author.${field}`)
}

function manifestExtensions(value: unknown, diagnostics: AgentPluginDiagnostic[]) {
  if (value === undefined) return
  if (!object(value)) {
    diagnostics.push(diagnostic('manifest', 'The non-object extensions field was ignored', 'extensions', 'warning'))
  }
}

function manifest(value: Record<string, unknown>, diagnostics: AgentPluginDiagnostic[]) {
  if (value.$schema !== AGENT_PLUGIN_SCHEMA) throw new Error(`plugin.json must target the supported ${AGENT_PLUGIN_SCHEMA} schema`)
  const name = string(value.name, 'plugin.json name', true)
  if (name.length > 64 || !pluginName.test(name)) throw new Error('plugin.json name does not satisfy the Agent Plugins naming rules')
  for (const field of Object.keys(value)) {
    if (!manifestFields.has(field)) diagnostics.push(diagnostic('manifest', `Unknown field "${field}" was ignored`, field, 'warning'))
  }
  manifestAuthor(value.author)
  string(value.version, 'plugin.json version')
  string(value.description, 'plugin.json description')
  string(value.homepage, 'plugin.json homepage')
  string(value.repository, 'plugin.json repository')
  string(value.license, 'plugin.json license')
  stringArray(value.keywords, 'plugin.json keywords')
  manifestExtensions(value.extensions, diagnostics)
  return {
    name,
    version: string(value.version, 'plugin.json version'),
    description: string(value.description, 'plugin.json description'),
    homepage: string(value.homepage, 'plugin.json homepage'),
    repository: string(value.repository, 'plugin.json repository'),
  }
}

function frontmatterMetadata(contents: string) {
  const normalized = contents.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---(?:\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter')
  const document = parseDocument(match[1]!, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`SKILL.md frontmatter is invalid YAML: ${document.errors[0]!.message}`)
  const metadata = document.toJS({ maxAliasCount: 100 }) as unknown
  if (!object(metadata)) throw new Error('SKILL.md frontmatter must be an object')
  return metadata
}

function validatedSkillName(metadata: Record<string, unknown>, directoryName: string) {
  const name = string(metadata.name, 'SKILL.md name', true)
  if (name.length > 64 || !skillName.test(name)) throw new Error('SKILL.md name does not satisfy the Agent Skills naming rules')
  if (name !== directoryName) throw new Error('SKILL.md name must match its parent directory')
  return name
}

function validateOptionalSkillMetadata(metadata: Record<string, unknown>) {
  const compatibility = metadata.compatibility
  if (compatibility !== undefined && string(compatibility, 'SKILL.md compatibility', true).length > 500)
    throw new Error('SKILL.md compatibility must be at most 500 characters')
  if (metadata.license !== undefined) string(metadata.license, 'SKILL.md license')
  if (metadata['allowed-tools'] !== undefined) string(metadata['allowed-tools'], 'SKILL.md allowed-tools')
  if (metadata.metadata !== undefined) stringObject(metadata.metadata, 'SKILL.md metadata')
}

function frontmatter(contents: string, directoryName: string) {
  const metadata = frontmatterMetadata(contents)
  const name = validatedSkillName(metadata, directoryName)
  const description = string(metadata.description, 'SKILL.md description', true)
  if (description.length > 1_024) throw new Error('SKILL.md description must be at most 1024 characters')
  validateOptionalSkillMetadata(metadata)
  return { name, description }
}

async function skillsDirectory(root: string, diagnostics: AgentPluginDiagnostic[]) {
  try {
    const directory = await containedPath(root, join(root, 'skills'), 'skills')
    if (!(await stat(directory)).isDirectory()) throw new Error('skills must resolve to a directory')
    return directory
  } catch (error) {
    if (missingPath(error)) return null
    diagnostics.push(diagnostic('skills', error instanceof Error ? error.message : String(error)))
    return null
  }
}

async function pluginSkill(
  root: string,
  directory: string,
  entry: Dirent,
  pluginId: string,
  sourceName: string,
  url: string,
): Promise<AgentPluginStoredSkill | null> {
  const skillDirectory = await containedPath(root, join(directory, entry.name), `Skill ${entry.name}`)
  if (!(await stat(skillDirectory)).isDirectory()) return null
  const file = join(skillDirectory, 'SKILL.md')
  try {
    await access(file, constants.F_OK)
  } catch {
    return null
  }
  const skillFile = await containedPath(root, file, `Skill ${entry.name} SKILL.md`)
  const metadata = frontmatter(await boundedFile(skillFile, `Skill ${entry.name} SKILL.md`), entry.name)
  return {
    id: id('skill', `${pluginId}:${metadata.name}`),
    source: `agent-plugin:${sourceName}`,
    skill: metadata.name,
    name: metadata.name,
    description: metadata.description,
    url: url.length <= 2_000 ? url : '',
    defaultEnabled: false,
    pluginId,
    pluginRoot: root,
    skillFile,
    skillDirectory,
  }
}

async function discoverSkills(root: string, pluginId: string, sourceName: string, url: string, diagnostics: AgentPluginDiagnostic[]) {
  const directory = await skillsDirectory(root, diagnostics)
  if (!directory) return []
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
  const skills: AgentPluginStoredSkill[] = []
  for (const entry of entries) {
    try {
      const loaded = await pluginSkill(root, directory, entry, pluginId, sourceName, url)
      if (loaded) skills.push(loaded)
    } catch (error) {
      diagnostics.push(diagnostic('skills', error instanceof Error ? error.message : String(error), entry.name))
    }
  }
  return skills
}

function exactFields(value: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(value).find((field) => !allowed.includes(field))
  if (unknown) throw new Error(`contains unknown field "${unknown}"`)
}

function expand(value: string, root: string, data: string) {
  return value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/g, (_match, name: string) => (name === 'ROOT' ? root : data))
}

async function stdioCwd(value: unknown, root: string, data: string) {
  if (value === undefined) return root
  const configured = string(value, 'cwd')
  const fromData = configured === '${PLUGIN_DATA}' || configured.startsWith('${PLUGIN_DATA}/')
  const fromRoot = configured === '${PLUGIN_ROOT}' || configured.startsWith('${PLUGIN_ROOT}/') || configured.startsWith('./')
  if (!fromData && !fromRoot) throw new Error('cwd must be plugin-relative or rooted at ${PLUGIN_ROOT} or ${PLUGIN_DATA}')
  const base = fromData ? data : root
  const expanded = resolve(expand(configured.startsWith('./') ? join(root, configured.slice(2)) : configured, root, data))
  return containedDirectory(base, expanded, fromData)
}

async function stdioServer(
  value: Record<string, unknown>,
  pluginId: string,
  pluginName: string,
  serverName: string,
  root: string,
  data: string,
): Promise<AgentMcpServer> {
  exactFields(value, ['type', 'command', 'args', 'env', 'cwd'])
  const configuredCommand = string(value.command, 'command', true)
  if (configuredCommand.includes('\0')) throw new Error('command must not contain null bytes')
  let command: string
  if (configuredCommand.startsWith('./')) {
    command = await containedPath(root, resolve(root, configuredCommand.slice(2)), `MCP server ${serverName} command`)
    if (!(await stat(command)).isFile()) throw new Error('command must resolve to a regular file')
  } else {
    if (!/^[^\s/\\]+$/.test(configuredCommand)) throw new Error('command must be one bare executable token or start with ./')
    command = configuredCommand
  }
  const args = stringArray(value.args, 'args')
  const configuredEnvironment = stringObject(value.env, 'env')
  if (Object.keys(configuredEnvironment).some((name) => !name || name.includes('\0') || name.includes('=')))
    throw new Error('env contains a name that cannot be represented by the platform')
  if (
    Object.keys(configuredEnvironment).some((name) =>
      process.platform === 'win32'
        ? ['PLUGIN_ROOT', 'PLUGIN_DATA'].includes(name.toUpperCase())
        : name === 'PLUGIN_ROOT' || name === 'PLUGIN_DATA',
    )
  )
    throw new Error('env must not define PLUGIN_ROOT or PLUGIN_DATA')
  if ([...args, ...Object.values(configuredEnvironment)].some((entry) => entry.includes('\0')))
    throw new Error('arguments and environment values must not contain null bytes')
  const env = Object.fromEntries(Object.entries(configuredEnvironment).map(([name, entry]) => [name, expand(entry, root, data)]))
  env.PLUGIN_ROOT = root
  env.PLUGIN_DATA = data
  return {
    id: id('mcp', `${pluginId}:${serverName}`),
    name: componentName(pluginName, serverName),
    transport: 'stdio',
    command,
    args: args.map((entry) => expand(entry, root, data)),
    env,
    cwd: await stdioCwd(value.cwd, root, data),
    defaultEnabled: false,
    pluginId,
  }
}

function loopback(hostname: string) {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (host === 'localhost' || host === '::1') return true
  return isIP(host) === 4 && host.split('.')[0] === '127'
}

function remoteUrl(value: Record<string, unknown>) {
  const configuredUrl = string(value.url, 'url', true)
  let url: URL
  try {
    url = new URL(configuredUrl)
  } catch {
    throw new Error('url must be an absolute HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('url must be an absolute HTTP(S) URL without user information or a fragment')
  if (url.protocol !== 'https:' && !loopback(url.hostname)) throw new Error('non-loopback MCP endpoints must use HTTPS')
  return url
}

function remoteHeaders(value: unknown) {
  const headers = stringObject(value, 'headers')
  const normalizedNames = new Set<string>()
  for (const [name, entry] of Object.entries(headers)) {
    try {
      validateHeaderName(name)
      validateHeaderValue(name, entry)
    } catch {
      throw new Error(`header "${name}" is not a valid HTTP header`)
    }
    const normalized = name.toLowerCase()
    if (normalizedNames.has(normalized)) throw new Error(`header "${name}" is duplicated with different casing`)
    normalizedNames.add(normalized)
  }
  return headers
}

function remoteServer(value: Record<string, unknown>, pluginId: string, pluginName: string, serverName: string): AgentMcpServer {
  exactFields(value, ['type', 'url', 'headers'])
  const url = remoteUrl(value)
  const headers = remoteHeaders(value.headers)
  return {
    id: id('mcp', `${pluginId}:${serverName}`),
    name: componentName(pluginName, serverName),
    transport: value.type === 'sse' ? 'sse' : 'http',
    url: url.toString(),
    headers,
    defaultEnabled: false,
    pluginId,
  }
}

function componentName(pluginName: string, name: string) {
  const safeName = name.replace(/[\u0000-\u001f\u007f]/g, '�').trim()
  const suffix = createHash('sha256').update(name).digest('hex').slice(0, 10)
  const displayName = `${pluginName}/${safeName || `unnamed-${suffix}`}${safeName === name ? '' : `-${suffix}`}`
  if (displayName.length <= 180) return displayName
  return `${displayName.slice(0, 160)}…${createHash('sha256').update(displayName).digest('hex').slice(0, 16)}`
}

function mcpConfiguration(value: Record<string, unknown>) {
  exactFields(value, ['$schema', 'mcpServers'])
  if (value.$schema !== AGENT_PLUGIN_MCP_SCHEMA) throw new Error(`mcp.json must target the supported ${AGENT_PLUGIN_MCP_SCHEMA} schema`)
  if (!object(value.mcpServers)) throw new Error('mcp.json mcpServers must be an object')
  return value.mcpServers
}

async function configuredMcpServer(entry: unknown, pluginId: string, pluginName: string, name: string, root: string, data: string) {
  if (!object(entry)) throw new Error('server configuration must be an object')
  if (!['stdio', 'streamable-http', 'sse'].includes(String(entry.type))) throw new Error('server type is unsupported')
  return entry.type === 'stdio'
    ? stdioServer(entry, pluginId, pluginName, name, root, data)
    : remoteServer(entry, pluginId, pluginName, name)
}

async function discoverMcp(root: string, data: string, pluginId: string, pluginName: string, diagnostics: AgentPluginDiagnostic[]) {
  const path = join(root, 'mcp.json')
  try {
    await access(path, constants.F_OK)
  } catch {
    return []
  }
  let serversByName: Record<string, unknown>
  try {
    serversByName = mcpConfiguration(await jsonFile(root, path, 'mcp.json'))
  } catch (error) {
    diagnostics.push(diagnostic('mcp', error instanceof Error ? error.message : String(error)))
    return []
  }
  const servers: AgentMcpServer[] = []
  for (const [name, entry] of Object.entries(serversByName)) {
    try {
      servers.push(await configuredMcpServer(entry, pluginId, pluginName, name, root, data))
    } catch (error) {
      diagnostics.push(diagnostic('mcp', error instanceof Error ? error.message : String(error), name))
    }
  }
  return servers
}

export async function loadAgentPlugin(inputPath: string, pluginDataRoot: string, trustedRoots?: string[]): Promise<LoadedAgentPlugin> {
  const source = trustedRoots ? await trustedPluginPath(inputPath, trustedRoots) : inputPath
  const root = await pluginRoot(source)
  const diagnostics: AgentPluginDiagnostic[] = []
  const metadata = manifest(await jsonFile(root, join(root, 'plugin.json'), 'plugin.json'), diagnostics)
  const pluginId = id('agent-plugin', root)
  await mkdir(pluginDataRoot, { recursive: true })
  const resolvedDataRoot = await realpath(pluginDataRoot)
  const dataCandidate = join(resolvedDataRoot, pluginId)
  await mkdir(dataCandidate, { recursive: true })
  const data = await realpath(dataCandidate)
  if (!pathWithin(resolvedDataRoot, data)) throw new Error('Agent Plugin data directory resolves outside the managed data root')
  const url = metadata.repository || metadata.homepage
  const skills = await discoverSkills(root, pluginId, metadata.name, url, diagnostics)
  const mcpServers = await discoverMcp(root, data, pluginId, metadata.name, diagnostics)
  const now = new Date().toISOString()
  return {
    plugin: {
      id: pluginId,
      name: metadata.name,
      version: metadata.version.slice(0, 1_000),
      description: metadata.description.slice(0, 10_000),
      root,
      homepage: metadata.homepage.slice(0, 10_000),
      repository: metadata.repository.slice(0, 10_000),
      skillIds: skills.map((skill) => skill.id),
      mcpServerIds: mcpServers.map((server) => server.id),
      diagnostics,
      installedAt: now,
      updatedAt: now,
    },
    skills,
    mcpServers,
  }
}

export async function readPluginSkill(skill: AgentPluginStoredSkill) {
  const file = await containedPath(skill.pluginRoot, skill.skillFile, `Skill ${skill.name} SKILL.md`)
  const contents = (await boundedFile(file, `Skill ${skill.name} SKILL.md`)).trim()
  if (!contents) throw new Error(`Skill ${skill.name} returned invalid instructions`)
  return `${contents}\n\nSkill directory: ${skill.skillDirectory}\nResolve relative paths in this skill against that directory.`
}
