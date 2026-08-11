import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { colors } from '@/theme'
import { CollectionChip } from './portable-collection-presentation'
import { portableCollectionStyles as styles } from './portable-collection-styles'
import type { AgentOptions } from './portable-action-values'
import { useMobileAgentOptions, type SelectableAgent, type SelectableModel } from './use-mobile-agent-options'

type MobileAgentOptionsProps = {
  serviceUrl: string
  backendId: string
  value: AgentOptions
  onChange(value: AgentOptions): void
  lockedAgentId?: string
}

export function MobileAgentOptions({ serviceUrl, backendId, value, onChange, lockedAgentId }: MobileAgentOptionsProps) {
  const state = useMobileAgentOptions(serviceUrl, backendId, value, onChange)
  return (
    <View testID="agent-options" style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Agent execution</Text>
      <AgentOptionsState {...state} value={value} lockedAgentId={lockedAgentId} onChange={onChange} />
    </View>
  )
}

function AgentOptionsState({
  agents,
  models,
  loading,
  error,
  retry,
  value,
  lockedAgentId,
  onChange,
}: ReturnType<typeof useMobileAgentOptions> & Pick<MobileAgentOptionsProps, 'value' | 'onChange' | 'lockedAgentId'>) {
  if (loading) return <AgentOptionsLoading />
  if (error) return <AgentOptionsError error={error} retry={retry} />
  return <AgentOptionSelectors agents={agents} models={models} value={value} lockedAgentId={lockedAgentId} onChange={onChange} />
}

function AgentOptionsLoading() {
  return (
    <View testID="agent-options-loading" accessibilityRole="progressbar">
      <ActivityIndicator color={colors.accent} />
    </View>
  )
}

function AgentOptionsError({ error, retry }: { error: string; retry(): void }) {
  return (
    <View>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Retry agent options</Text>
      </Pressable>
    </View>
  )
}

function AgentOptionSelectors({ agents, models, value, onChange, lockedAgentId }: Pick<MobileAgentOptionsProps, 'value' | 'onChange' | 'lockedAgentId'> & {
  agents: SelectableAgent[]
  models: SelectableModel[]
}) {
  const selectedModel = models.find((model) => model.id === value.model)
  return (
    <>
      <AgentSelector agents={agents} value={value} locked={Boolean(lockedAgentId)} onChange={onChange} />
      <ModelSelector models={models} value={value} onChange={onChange} />
      {selectedModel ? <ReasoningSelector model={selectedModel} value={value} onChange={onChange} /> : null}
      {value.agentId === 'codex' ? <ServiceTierSelector value={value} onChange={onChange} /> : null}
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.inputLabel}>Delegate to subagents</Text>
          <Text style={styles.subtitle}>Allow this run to split independent work across child agents.</Text>
        </View>
        <Switch
          accessibilityLabel="Delegate to subagents"
          value={Boolean(value.allowSubagents)}
          onValueChange={(allowSubagents) => onChange({ ...value, allowSubagents })}
          trackColor={{ true: colors.accentSoft }}
          thumbColor={value.allowSubagents ? colors.accent : colors.muted}
        />
      </View>
    </>
  )
}

function AgentSelector({ agents, value, locked, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & {
  agents: SelectableAgent[]
  locked: boolean
}) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.chips}>
      {agents.length ? agents.map((agent) => (
        <CollectionChip
          active={value.agentId === agent.id}
          disabled={locked}
          key={agent.id}
          label={agent.name}
          onPress={() => onChange({
            ...value,
            agentId: agent.id,
            model: '',
            reasoningEffort: '',
            serviceTier: agent.id === 'codex' ? value.serviceTier : '',
          })}
        />
      )) : <Text style={styles.subtitle}>No selectable agents available.</Text>}
    </ScrollView>
  )
}

function ServiceTierSelector({ value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'>) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.chips}>
      <CollectionChip active={!value.serviceTier} label="Normal speed" onPress={() => onChange({ ...value, serviceTier: '' })} />
      <CollectionChip active={value.serviceTier === 'priority'} label="Fast" onPress={() => onChange({ ...value, serviceTier: 'priority' })} />
    </ScrollView>
  )
}

function ModelSelector({ models, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & { models: SelectableModel[] }) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.chips}>
      <CollectionChip active={!value.model} label="Default model" onPress={() => onChange({ ...value, model: '', reasoningEffort: '' })} />
      {models.map((model) => (
        <CollectionChip
          active={value.model === model.id}
          key={model.id}
          label={model.name}
          onPress={() => onChange({ ...value, model: model.id, reasoningEffort: '' })}
        />
      ))}
    </ScrollView>
  )
}

function ReasoningSelector({ model, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & { model: SelectableModel }) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.chips}>
      <CollectionChip active={!value.reasoningEffort} label="Default reasoning" onPress={() => onChange({ ...value, reasoningEffort: '' })} />
      {model.reasoning_efforts.map((effort) => (
        <CollectionChip
          active={value.reasoningEffort === effort.id}
          key={effort.id}
          label={effort.id}
          onPress={() => onChange({ ...value, reasoningEffort: effort.id })}
        />
      ))}
    </ScrollView>
  )
}
