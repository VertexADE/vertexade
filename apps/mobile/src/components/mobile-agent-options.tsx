import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { colors } from '@/theme'
import { CollectionChip } from './portable-collection-presentation'
import { portableCollectionStyles as styles } from './portable-collection-styles'
import type { AgentOptions } from './portable-action-values'
import { useMobileAgentOptions, type SelectableAgent, type SelectableModel } from './use-mobile-agent-options'

type MobileAgentOptionsProps = {
  server: string
  value: AgentOptions
  onChange(value: AgentOptions): void
}

export function MobileAgentOptions({ server, value, onChange }: MobileAgentOptionsProps) {
  const state = useMobileAgentOptions(server, value, onChange)
  return (
    <View testID="agent-options" style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Agent execution</Text>
      <AgentOptionsState {...state} value={value} onChange={onChange} />
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
  onChange,
}: ReturnType<typeof useMobileAgentOptions> & Pick<MobileAgentOptionsProps, 'value' | 'onChange'>) {
  if (loading) return <AgentOptionsLoading />
  if (error) return <AgentOptionsError error={error} retry={retry} />
  return <AgentOptionSelectors agents={agents} models={models} value={value} onChange={onChange} />
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

function AgentOptionSelectors({ agents, models, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & {
  agents: SelectableAgent[]
  models: SelectableModel[]
}) {
  const selectedModel = models.find((model) => model.id === value.model)
  return (
    <>
      <AgentSelector agents={agents} value={value} onChange={onChange} />
      <ModelSelector models={models} value={value} onChange={onChange} />
      {selectedModel ? <ReasoningSelector model={selectedModel} value={value} onChange={onChange} /> : null}
    </>
  )
}

function AgentSelector({ agents, value, onChange }: Pick<MobileAgentOptionsProps, 'value' | 'onChange'> & { agents: SelectableAgent[] }) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.chips}>
      {agents.length ? agents.map((agent) => (
        <CollectionChip
          active={value.agentId === agent.id}
          key={agent.id}
          label={agent.name}
          onPress={() => onChange({ agentId: agent.id, model: '', reasoningEffort: '' })}
        />
      )) : <Text style={styles.subtitle}>No selectable agents available.</Text>}
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
