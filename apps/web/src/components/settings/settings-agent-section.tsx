import { Bot, Braces, Gauge, Wrench } from 'lucide-react'
import { AgentResourceSettings } from '@vertexade/ui/components/agent-resource-settings'
import {
  PromptPolicySettings,
  RuntimeSettings,
  ToolPathSettings,
  type SystemConfigurationValue,
} from '@vertexade/ui/components/system-configuration-settings'
import type { DashboardData } from '@vertexade/ui/lib/dashboard-types'
import { ContentGenerationDefaults, Presets } from './settings-panels'
import { SettingsGroup, SettingsPageHeader, SettingsSectionDivider } from './settings-shared'
import { ThreadRuntimeDefaultSettings } from './settings-thread-runtime-defaults'
import type { ContentGenerationSettings, ThreadRuntimeDefaults } from './settings-types'

const settingsSectionClass = 'flex min-w-0 flex-col gap-5 [&_[data-slot=card]]:min-w-0'

export function SettingsAgentSection({
  backendId,
  contentGeneration,
  onContentGenerationSaved,
  presets,
  systemConfiguration,
  onSystemConfigurationSaved,
  threadDefaults,
  onThreadDefaultsSaved,
}: {
  backendId: string
  contentGeneration: ContentGenerationSettings
  onContentGenerationSaved(value: ContentGenerationSettings): void
  presets: DashboardData['presets']
  systemConfiguration: SystemConfigurationValue
  onSystemConfigurationSaved(value: SystemConfigurationValue): void
  threadDefaults: ThreadRuntimeDefaults
  onThreadDefaultsSaved(value: ThreadRuntimeDefaults): void
}) {
  return (
    <section data-slot="settings-section" aria-labelledby="agent-settings" className={settingsSectionClass}>
      <SettingsPageHeader
        id="agent-settings"
        eyebrow="Agents"
        title="Defaults & instructions"
        description="Choose safe model defaults, centralize workspace guidance, and define the runtime boundaries used by Work-item and review threads."
        icon={Gauge}
        badge="Workspace-wide"
        summary={[
          {
            label: 'Generated text',
            value: contentGeneration.model || contentGeneration.agentId || 'Not configured',
            detail: 'Read-only',
          },
          {
            label: 'Thread defaults',
            value: threadDefaults.workItem.agentId && threadDefaults.review.agentId ? 'Configured' : 'Incomplete',
            detail: 'Work + reviews',
          },
          {
            label: 'Prompt presets',
            value: String(presets.length),
            detail: 'Reusable',
          },
        ]}
      />
      <SettingsGroup
        id="agents-defaults"
        title="Execution defaults"
        description="Set the providers and models used when a workflow does not choose its own runtime."
        icon={Gauge}
      >
        <ContentGenerationDefaults
          key={`${backendId}:${contentGeneration.agentId}:${contentGeneration.model}:${contentGeneration.reasoningEffort}`}
          value={contentGeneration}
          onSaved={onContentGenerationSaved}
          backendId={backendId}
        />
        <ThreadRuntimeDefaultSettings
          key={`${backendId}:${threadDefaults.workItem.agentId}:${threadDefaults.review.agentId}`}
          value={threadDefaults}
          onSaved={onThreadDefaultsSaved}
          backendId={backendId}
        />
      </SettingsGroup>
      <SettingsSectionDivider />
      <SettingsGroup
        id="agents-instructions"
        title="Instructions"
        description="Maintain trusted workspace policy and reusable prompts separately from model selection."
        icon={Braces}
      >
        <PromptPolicySettings value={systemConfiguration} onSaved={onSystemConfigurationSaved} backendId={backendId} />
        <Presets presets={presets} backendId={backendId} />
      </SettingsGroup>
      <SettingsSectionDivider />
      <SettingsGroup
        id="agents-custom"
        title="Custom agents"
        description="Create reusable agent presets. Skills and MCP servers are managed under Extensions."
        icon={Bot}
      >
        <AgentResourceSettings section="agents" backendId={backendId} />
      </SettingsGroup>
      <SettingsSectionDivider />
      <SettingsGroup
        id="agents-runtime"
        title="Runtime & tools"
        description="Control executable discovery, retry behavior, concurrency, and automation limits."
        icon={Wrench}
        badge="Advanced"
      >
        <ToolPathSettings value={systemConfiguration} onSaved={onSystemConfigurationSaved} backendId={backendId} />
        <RuntimeSettings value={systemConfiguration} onSaved={onSystemConfigurationSaved} backendId={backendId} />
      </SettingsGroup>
    </section>
  )
}
