import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import {
  addMobileSkill,
  callMobileMcpTool,
  loadMobileMcpApp,
  loadMobileMcpTools,
  loadMobileAgentResources,
  removeMobileAgentResource,
  saveMobileCustomAgent,
  saveMobileMcpServer,
  searchMobileMcpRegistry,
  setMobileResourceDefault,
  type MobileAgentResourceCatalog,
  type MobileCustomAgent,
  type MobileMcpRegistryResult,
  type MobileMcpAppDescriptor,
  type MobileMcpTool,
} from '@/mobile-agent-resources'
import { colors } from '@/theme'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileMcpApp } from './mobile-mcp-app'
import { MobileSheetHeader } from './mobile-sheet-header'
import { mobileServerSettingsStyles as styles } from './mobile-server-agent-settings.styles'

type Section = 'agents' | 'skills' | 'mcp'
const emptyCatalog: MobileAgentResourceCatalog = { profiles: [], skills: [], mcpServers: [] }

export function MobileServerAgentSettings({ backendId, serverName, serviceUrl, visible, onClose }: { backendId: string; serverName: string; serviceUrl: string; visible: boolean; onClose(): void }) {
  const [section, setSection] = useState<Section>('agents')
  const [catalog, setCatalog] = useState(emptyCatalog)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setCatalog(await loadMobileAgentResources(serviceUrl, backendId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load agent settings') }
    finally { setLoading(false) }
  }, [backendId, serviceUrl])
  useEffect(() => { if (visible) void load() }, [load, visible])

  return <Modal allowSwipeDismissal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
    <MobileModalSafeArea style={styles.screen}>
      <MobileSheetHeader title="Extensions" subtitle={`${serverName} · agents, skills, and MCP servers`} trailingLabel="Done" onTrailing={onClose} />
      <View style={styles.tabs}>{(['agents', 'skills', 'mcp'] as const).map((item) => <Pressable key={item} onPress={() => setSection(item)} style={[styles.tab, section === item && styles.tabActive]}><Text style={[styles.tabText, section === item && styles.tabTextActive]}>{item === 'mcp' ? 'MCP' : item[0].toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
      <SettingsContent loading={loading} error={error} section={section} catalog={catalog} serviceUrl={serviceUrl} backendId={backendId} reload={load} />
    </MobileModalSafeArea>
  </Modal>
}

function SettingsContent({ loading, error, section, catalog, ...context }: SettingsSectionProps & { loading: boolean; error: string; section: Section }) {
  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.accent} /></View>
  if (error) return <View style={styles.state}><Text style={styles.error}>{error}</Text><Action label="Retry" onPress={() => void context.reload()} /></View>
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    {section === 'agents' ? <AgentsSection catalog={catalog} {...context} /> : null}
    {section === 'skills' ? <SkillsSection catalog={catalog} {...context} /> : null}
    {section === 'mcp' ? <McpSection catalog={catalog} {...context} /> : null}
  </ScrollView>
}

function SkillsSection({ catalog, ...context }: SettingsSectionProps) {
  const [reference, setReference] = useState('')
  async function add() {
    const [source, skill] = reference.trim().split('@')
    if (!source || !skill) return contextError('Use owner/repository@skill-name')
    await addMobileSkill(context.serviceUrl, context.backendId, source, skill); setReference(''); await context.reload()
  }
  return <><SectionHeading title="AI skills" text="Add a skills.sh reference and choose whether it is enabled by default." /><InlineForm value={reference} placeholder="owner/repository@skill" onChange={setReference} onSave={() => void run(add)} label="Add" />
    {catalog.skills.map((skill) => <ResourceRow key={skill.id} name={skill.name} detail={`${skill.source}@${skill.skill}`} enabled={skill.defaultEnabled} onToggle={(enabled) => void run(async () => { await setMobileResourceDefault(context.serviceUrl, context.backendId, 'skill', skill.id, enabled); await context.reload() })} onRemove={() => confirmRemove(skill.name, async () => { await removeMobileAgentResource(context.serviceUrl, context.backendId, 'skill', skill.id); await context.reload() })} />)}
    {!catalog.skills.length ? <Empty text="No skills added to this server." /> : null}</>
}

function McpSection({ catalog, ...context }: SettingsSectionProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MobileMcpRegistryResult[]>([])
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [args, setArgs] = useState<string[]>([])
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [explorer, setExplorer] = useState<{ serverId: string; tools: MobileMcpTool[]; app: MobileMcpAppDescriptor | null; loading: boolean; error: string }>({ serverId: '', tools: [], app: null, loading: false, error: '' })
  async function search() { if (!query.trim()) return; setResults(await searchMobileMcpRegistry(context.serviceUrl, context.backendId, query)) }
  function configure(result: MobileMcpRegistryResult) { if (!result.installable || !result.transport) return; setName(result.name); setTransport(result.transport); setEndpoint(result.transport === 'stdio' ? result.command || '' : result.url || ''); setArgs(result.args || []); if (result.requiredInputs.length) Alert.alert('Configuration required', `Add these values after installation: ${result.requiredInputs.join(', ')}`) }
  async function add() { if (!name.trim() || !endpoint.trim()) return contextError('Name and command or URL are required'); await saveMobileMcpServer(context.serviceUrl, context.backendId, { name: name.trim(), endpoint: endpoint.trim(), transport, args }); setName(''); setEndpoint(''); setArgs([]); await context.reload() }
  async function inspect(serverId: string) {
    setExplorer({ serverId, tools: [], app: null, loading: true, error: '' })
    try { setExplorer({ serverId, tools: await loadMobileMcpTools(context.serviceUrl, context.backendId, serverId), app: null, loading: false, error: '' }) }
    catch (reason) { setExplorer({ serverId, tools: [], app: null, loading: false, error: reason instanceof Error ? reason.message : 'Could not inspect this MCP server' }) }
  }
  async function openApp(tool: MobileMcpTool) {
    try { setExplorer((current) => ({ ...current, loading: true, error: '' })); const app = await loadMobileMcpApp(context.serviceUrl, context.backendId, explorer.serverId, tool.name); setExplorer((current) => ({ ...current, app, loading: false })) }
    catch (reason) { setExplorer((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : 'Could not open this MCP App' })) }
  }
  return <><SectionHeading title="MCP servers" text="Search the official MCP Registry or configure a server manually." />
    <InlineForm value={query} placeholder="Search official MCP Registry" onChange={setQuery} onSave={() => void run(search)} label="Search" />
    {results.map((result) => <View key={`${result.id}@${result.version}`} style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{result.name}</Text><Text numberOfLines={2} style={styles.rowDetail}>{result.description}</Text><Text numberOfLines={1} style={styles.rowDetail}>{result.id}@{result.version}</Text></View><Action label={result.installable ? 'Configure' : 'Unsupported'} onPress={() => configure(result)} /></View>)}
    <View style={styles.form}><TextInput accessibilityLabel="MCP server name" value={name} onChangeText={setName} placeholder="Server name" placeholderTextColor={colors.muted} style={styles.input} /><View style={styles.tabs}><Choice label="Command" selected={transport === 'stdio'} onPress={() => setTransport('stdio')} /><Choice label="HTTP" selected={transport === 'http'} onPress={() => setTransport('http')} /><Choice label="Legacy SSE" selected={transport === 'sse'} onPress={() => setTransport('sse')} /></View><TextInput accessibilityLabel="MCP endpoint" value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} placeholder={transport === 'stdio' ? 'Command path' : 'https://example.com/mcp'} placeholderTextColor={colors.muted} style={styles.input} />{transport === 'stdio' ? <TextInput accessibilityLabel="MCP arguments" value={args.join('\n')} onChangeText={(value) => setArgs(value.split(/\r?\n/).filter(Boolean))} multiline placeholder="One argument per line" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} /> : null}<Action label="Add MCP server" onPress={() => void run(add)} /></View>
    {catalog.mcpServers.map((server) => <View key={server.id} style={styles.row}><Pressable style={styles.rowCopy} onPress={() => void inspect(server.id)}><Text style={styles.rowTitle}>{server.name}</Text><Text numberOfLines={2} style={styles.rowDetail}>{server.transport === 'stdio' ? server.command || '' : server.url || ''}</Text><Text style={styles.inspectHint}>Inspect tools and apps</Text></Pressable><Switch accessibilityLabel={`Enable ${server.name} by default`} value={server.defaultEnabled} onValueChange={(enabled) => void run(async () => { await setMobileResourceDefault(context.serviceUrl, context.backendId, 'mcp', server.id, enabled); await context.reload() })} trackColor={{ true: colors.accentSoft }} thumbColor={server.defaultEnabled ? colors.accent : colors.muted} /><Action destructive label="Remove" onPress={() => confirmRemove(server.name, async () => { await removeMobileAgentResource(context.serviceUrl, context.backendId, 'mcp', server.id); await context.reload() })} /></View>)}
    {explorer.serverId ? <View style={styles.form}><Text style={styles.formTitle}>Available tools and apps</Text>{explorer.loading ? <ActivityIndicator color={colors.accent} /> : null}{explorer.error ? <Text style={styles.error}>{explorer.error}</Text> : null}{explorer.tools.map((tool) => <View key={tool.name} style={styles.toolRow}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{tool.title || tool.name}</Text>{tool.description ? <Text numberOfLines={2} style={styles.rowDetail}>{tool.description}</Text> : null}</View>{tool.appResourceUri ? <Action label="Open App" onPress={() => void openApp(tool)} /> : null}</View>)}{!explorer.loading && !explorer.tools.length && !explorer.error ? <Empty text="This server exposes no tools." /> : null}{explorer.app ? <MobileMcpApp app={explorer.app} callTool={(toolName, toolArgs, signal) => callMobileMcpTool(context.serviceUrl, context.backendId, explorer.serverId, toolName, toolArgs, signal)} /> : null}</View> : null}
    {!catalog.mcpServers.length ? <Empty text="No MCP servers configured." /> : null}</>
}

function AgentsSection({ catalog, ...context }: SettingsSectionProps) {
  const [editing, setEditing] = useState<MobileCustomAgent | null>(null)
  return <><SectionHeading title="Custom agents" text="Create reusable presets based on a native agent runtime." /><AgentForm key={editing?.id || 'new'} profile={editing} catalog={catalog} onCancel={() => setEditing(null)} onSave={async (profile) => { await saveMobileCustomAgent(context.serviceUrl, context.backendId, profile); setEditing(null); await context.reload() }} />
    {catalog.profiles.map((profile) => <View key={profile.id} style={styles.row}><Pressable style={styles.rowCopy} onPress={() => setEditing(profile)}><Text style={styles.rowTitle}>{profile.name}</Text><Text style={styles.rowDetail}>{profile.description || `${profile.agentId} · ${profile.model || 'default model'}`}</Text></Pressable><Action label="Edit" onPress={() => setEditing(profile)} /><Action destructive label="Delete" onPress={() => confirmRemove(profile.name, async () => { await removeMobileAgentResource(context.serviceUrl, context.backendId, 'profiles', profile.id); await context.reload() })} /></View>)}
    {!catalog.profiles.length ? <Empty text="No custom agents on this server." /> : null}</>
}

function AgentForm({ profile, catalog, onSave, onCancel }: { profile: MobileCustomAgent | null; catalog: MobileAgentResourceCatalog; onSave(profile: Omit<MobileCustomAgent, 'id'> & { id?: string }): Promise<void>; onCancel(): void }) {
  const [value, setValue] = useState(() => initialAgentForm(profile))
  function change<Key extends keyof typeof value>(key: Key, next: (typeof value)[Key]) { setValue((current) => ({ ...current, [key]: next })) }
  async function submit() { if (!value.name.trim() || !value.agentId.trim()) return contextError('Agent name and base agent are required'); await onSave({ ...(profile ? { id: profile.id } : {}), ...value, name: value.name.trim(), description: value.description.trim(), agentId: value.agentId.trim(), model: value.model.trim(), reasoningEffort: profile?.reasoningEffort || '', promptPrefix: value.promptPrefix.trim() }) }
  return <View style={styles.form}><Text style={styles.formTitle}>{profile ? `Edit ${profile.name}` : 'New custom agent'}</Text><TextInput value={value.name} onChangeText={(next) => change('name', next)} placeholder="Agent name" placeholderTextColor={colors.muted} style={styles.input} /><TextInput value={value.description} onChangeText={(next) => change('description', next)} placeholder="Purpose" placeholderTextColor={colors.muted} style={styles.input} /><TextInput value={value.agentId} onChangeText={(next) => change('agentId', next)} autoCapitalize="none" placeholder="Base agent ID, e.g. codex" placeholderTextColor={colors.muted} style={styles.input} /><TextInput value={value.model} onChangeText={(next) => change('model', next)} autoCapitalize="none" placeholder="Model override (optional)" placeholderTextColor={colors.muted} style={styles.input} /><TextInput value={value.promptPrefix} onChangeText={(next) => change('promptPrefix', next)} multiline placeholder="Prompt to prepend (optional)" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} /><Checklist title="Preset skills" items={catalog.skills} selected={value.skillIds} onChange={(next) => change('skillIds', next)} /><Checklist title="Preset MCP servers" items={catalog.mcpServers} selected={value.mcpServerIds} onChange={(next) => change('mcpServerIds', next)} /><View style={styles.actions}>{profile ? <Action label="Cancel" onPress={onCancel} /> : null}<Action primary label={profile ? 'Save agent' : 'Create agent'} onPress={() => void run(submit)} /></View></View>
}

function initialAgentForm(profile: MobileCustomAgent | null) {
  if (profile) return { name: profile.name, agentId: profile.agentId, description: profile.description, model: profile.model, promptPrefix: profile.promptPrefix, skillIds: profile.skillIds, mcpServerIds: profile.mcpServerIds }
  return { name: '', agentId: 'codex', description: '', model: '', promptPrefix: '', skillIds: [] as string[], mcpServerIds: [] as string[] }
}

function Checklist({ title, items, selected, onChange }: { title: string; items: Array<{ id: string; name: string }>; selected: string[]; onChange(value: string[]): void }) { return <View style={styles.checklist}><Text style={styles.formTitle}>{title}</Text>{items.map((item) => <Pressable key={item.id} style={styles.checkRow} onPress={() => onChange(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.checkmark}>{selected.includes(item.id) ? '✓' : ''}</Text></Pressable>)}</View> }
type SettingsSectionProps = { catalog: MobileAgentResourceCatalog; serviceUrl: string; backendId: string; reload(): Promise<void> }
function SectionHeading({ title, text }: { title: string; text: string }) { return <View style={styles.heading}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{text}</Text></View> }
function ResourceRow({ name, detail, enabled, onToggle, onRemove }: { name: string; detail: string; enabled: boolean; onToggle(value: boolean): void; onRemove(): void }) { return <View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{name}</Text><Text numberOfLines={2} style={styles.rowDetail}>{detail}</Text></View><Switch accessibilityLabel={`Enable ${name} by default`} value={enabled} onValueChange={onToggle} trackColor={{ true: colors.accentSoft }} thumbColor={enabled ? colors.accent : colors.muted} /><Action destructive label="Remove" onPress={onRemove} /></View> }
function InlineForm({ value, placeholder, onChange, onSave, label }: { value: string; placeholder: string; onChange(value: string): void; onSave(): void; label: string }) { return <View style={styles.inline}><TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={colors.muted} style={[styles.input, styles.flex]} /><Action primary label={label} onPress={onSave} /></View> }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { return <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabActive]}><Text style={[styles.tabText, selected && styles.tabTextActive]}>{label}</Text></Pressable> }
function Action({ label, onPress, primary, destructive }: { label: string; onPress(): void; primary?: boolean; destructive?: boolean }) { return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, primary && styles.actionPrimary]}><Text style={[styles.actionText, primary && styles.actionPrimaryText, destructive && styles.destructive]}>{label}</Text></Pressable> }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text> }
async function run(action: () => Promise<void>) { try { await action() } catch (reason) { contextError(reason instanceof Error ? reason.message : 'The server rejected this change') } }
function contextError(message: string) { Alert.alert('Could not save', message) }
function confirmRemove(name: string, action: () => Promise<void>) { Alert.alert(`Remove ${name}?`, 'This only changes the selected server.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(action) }]) }
