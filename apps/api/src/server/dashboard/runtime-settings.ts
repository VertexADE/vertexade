import { normalizeAutomaticReviewConcurrency } from '../automatic-review-queue.ts'
import { normalizePreviewSettings } from '../previews/runtime.ts'
import type { JsonSettingsStore } from '../settings/settings-store.ts'

export type ThreadRuntimeChoice = { agentId: string; model: string; reasoningEffort: string; serviceTier: string }
export type ThreadRuntimeDefaults = { workItem: ThreadRuntimeChoice; review: ThreadRuntimeChoice }

export function threadRuntimeDefaults(settings: JsonSettingsStore, defaultAgentId: string): ThreadRuntimeDefaults {
  const fallback = { agentId: defaultAgentId, model: '', reasoningEffort: '', serviceTier: '' }
  const stored = settings.read<Partial<ThreadRuntimeDefaults>>('thread_runtime_defaults', {})
  return { workItem: { ...fallback, ...stored.workItem }, review: { ...fallback, ...stored.review } }
}

export function resolveThreadRuntime(
  settings: JsonSettingsStore,
  defaultAgentId: string,
  kind: keyof ThreadRuntimeDefaults,
  options: Partial<ThreadRuntimeChoice>,
): ThreadRuntimeChoice {
  const defaults = threadRuntimeDefaults(settings, defaultAgentId)[kind]
  return {
    agentId: options.agentId || defaults.agentId,
    model: options.model || defaults.model,
    reasoningEffort: options.reasoningEffort || defaults.reasoningEffort,
    serviceTier: options.serviceTier || defaults.serviceTier,
  }
}

export function reviewAutomationSettings(settings: JsonSettingsStore, defaultAgentId: string) {
  const concurrency = normalizeAutomaticReviewConcurrency(
    process.env.AUTOMATIC_REVIEW_CONCURRENCY || process.env.OPENCODE_AUTOMATIC_REVIEW_CONCURRENCY,
  )
  const defaults = {
    enabled: false,
    agentId: defaultAgentId,
    model: '',
    reasoningEffort: '',
    allowSubagents: false,
    concurrency,
    postToGitHub: false,
    onAssigned: true,
    titleSubstrings: [],
    labelSubstrings: [],
  }
  const value = { ...defaults, ...settings.read('review_automation', {}) }
  return { ...value, enabled: false, concurrency: normalizeAutomaticReviewConcurrency(value.concurrency) }
}

export function worktreePreviewSettings(settings: JsonSettingsStore) {
  return normalizePreviewSettings(settings.read('worktree_previews', {}))
}
