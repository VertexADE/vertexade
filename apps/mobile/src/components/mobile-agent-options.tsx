import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native'
import { colors } from '@/theme'
import { portableCollectionStyles as styles } from './portable-collection-styles'
import { MobileSingleSelect } from './mobile-single-select'
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
    <MobileSingleSelect
      enabled={!locked}
      label="Agent"
      options={agents.map((agent) => ({ id: agent.id, label: `${agent.name}${agent.preset ? ' · custom' : ''}` }))}
      value={value.agentId}
      testID="agent-select"
      onChange={(agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId)
        if (agent) onChange({
          ...value,
          agentId: agent.id,
          model: agent.preset?.model || '',
          reasoningEffort: agent.preset?.reasoningEffort || '',
          serviceTier: agent.id === 'codex' ? value.serviceTier : '',
        })
      }}
    />
  )
}

function ServiceTierSelector({ value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'>) {
  return (
    <MobileSingleSelect
      label="Service speed"
      options={[{ id: 'normal', label: 'Normal' }, { id: 'priority', label: 'Fast' }]}
      value={value.serviceTier || 'normal'}
      testID="service-tier-select"
      onChange={(serviceTier) => onChange({ ...value, serviceTier: serviceTier === 'normal' ? '' : serviceTier })}
    />
  )
}

function ModelSelector({ models, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & { models: SelectableModel[] }) {
  return (
    <MobileSingleSelect
      label="Model"
      options={[{ id: 'default', label: 'Default model' }, ...models.map((model) => ({ id: model.id, label: model.name }))]}
      value={value.model || 'default'}
      testID="model-select"
      onChange={(modelId) => {
        const model = models.find((candidate) => candidate.id === modelId)
        onChange({ ...value, model: model?.id || '', reasoningEffort: model?.default_reasoning_effort || '' })
      }}
    />
  )
}

function ReasoningSelector({ model, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & { model: SelectableModel }) {
  return (
    <MobileSingleSelect
      label="Reasoning"
      options={[{ id: 'default', label: 'Default reasoning' }, ...model.reasoning_efforts.map((effort) => ({ id: effort.id, label: effort.id }))]}
      value={value.reasoningEffort || 'default'}
      testID="reasoning-select"
      onChange={(reasoningEffort) => onChange({ ...value, reasoningEffort: reasoningEffort === 'default' ? '' : reasoningEffort })}
    />
  )
}
