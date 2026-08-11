import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import type { MobileReviewSuggestion, MobileThreadDetails } from '@/mobile-detail-service'
import { mobileThreadKind, type MobileThreadOutcome, type MobileThreadTab } from '@/mobile-thread-presentation'
import { colors } from '@/theme'
import { MobileDiff } from './mobile-diff'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailMetric, DetailSection } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'

export function MobileThreadHeaderContext({ detail }: { detail: MobileThreadDetails }) {
  return (
    <>
      <View style={styles.headerBadges}>
        <ThreadBadge label={`Run #${detail.id}`} />
        <ThreadBadge label={detail.backendName} />
        <ThreadBadge label={detail.agentName} />
        <ThreadBadge label={mobileThreadKind(detail)} />
        <ThreadStatusBadge status={detail.inputQuestions.length ? 'input required' : detail.status} />
      </View>
      <View style={styles.headerMetrics}>
        <HeaderMetric label="BRANCH" value={detail.branchName || 'No branch'} />
        <HeaderMetric label="PULL REQUEST" value={detail.pullRequestNumber ? `PR #${detail.pullRequestNumber}` : 'Awaiting PR'} />
        <HeaderMetric label="ELAPSED" value={duration(detail.createdAt, detail.finishedAt)} />
        <HeaderMetric label="WORKSPACE" value={workspaceName(detail)} />
      </View>
    </>
  )
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.headerMetric}>
      <Text style={styles.headerMetricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.headerMetricValue}>{value}</Text>
    </View>
  )
}

function ThreadBadge({ label }: { label: string }) {
  return <Text style={styles.badge}>{label}</Text>
}

function ThreadStatusBadge({ status }: { status: string }) {
  const danger = status === 'failed'
  const warning = ['input required', 'resumable', 'cancelled', 'interrupted'].includes(status)
  return <Text style={[styles.badge, danger && styles.badgeDanger, warning && !danger && { color: colors.warning }]}>{status}</Text>
}

export function MobileThreadOutcomeBanner({ outcome }: { outcome: MobileThreadOutcome }) {
  const toneStyle = {
    active: styles.outcomeActive,
    success: styles.outcomeSuccess,
    warning: styles.outcomeWarning,
    danger: styles.outcomeDanger,
    neutral: styles.outcomeNeutral,
  }[outcome.tone]
  return (
    <View accessibilityRole="summary" style={[styles.outcome, toneStyle]}>
      <Text style={styles.outcomeTitle}>{outcome.headline}</Text>
      <Text style={styles.outcomeText}>{outcome.description}</Text>
    </View>
  )
}

export function MobileThreadTabContent({
  tab,
  detail,
  suggestions,
  postingSuggestions,
  onChangeSuggestion,
  onPostSuggestions,
  activity,
}: {
  tab: MobileThreadTab
  detail: MobileThreadDetails
  suggestions: MobileReviewSuggestion[]
  postingSuggestions: boolean
  onChangeSuggestion(id: number, patch: Partial<MobileReviewSuggestion>): void
  onPostSuggestions(): void
  activity: ReactNode
}) {
  if (tab === 'activity') return activity
  if (tab === 'summary') return <ThreadSummary detail={detail} />
  if (tab === 'findings') return <ThreadFindings detail={detail} />
  if (tab === 'suggestions')
    return (
      <ThreadSuggestions
        status={detail.status}
        suggestions={suggestions}
        posting={postingSuggestions}
        onChange={onChangeSuggestion}
        onPost={onPostSuggestions}
      />
    )
  if (tab === 'changes') return <ThreadChanges detail={detail} />
  return <ThreadContext detail={detail} />
}

function ThreadSummary({ detail }: { detail: MobileThreadDetails }) {
  return (
    <DetailSection title={detail.reviewSummary ? 'Review summary' : 'Result'} meta={detail.ephemeral ? 'Private · Ephemeral' : 'Private'}>
      <MobileMarkdown
        content={detail.reviewSummary || detail.resultText}
        emptyText={`${detail.agentName} is still preparing the final result.`}
      />
    </DetailSection>
  )
}

function ThreadFindings({ detail }: { detail: MobileThreadDetails }) {
  const title = detail.kind === 'stack_analysis' ? 'Private PR stack report' : 'Complete private review'
  return (
    <DetailSection title={title} meta="Not posted">
      <MobileMarkdown
        content={detail.reviewDetails || detail.resultText}
        emptyText={`${detail.agentName} is still preparing the detailed report.`}
      />
    </DetailSection>
  )
}

function ThreadSuggestions({
  status,
  suggestions,
  posting,
  onChange,
  onPost,
}: {
  status: string
  suggestions: MobileReviewSuggestion[]
  posting: boolean
  onChange(id: number, patch: Partial<MobileReviewSuggestion>): void
  onPost(): void
}) {
  const selected = suggestions.filter((item) => item.selected && !item.postedAt)
  const ready = selected.filter((item) => item.side === 'RIGHT' && item.description.trim())
  const blocked = selected.length !== ready.length
  return (
    <DetailSection title="Suggestions on the PR diff" meta={`${ready.length} ready`}>
      <Text style={styles.muted}>Review and edit each proposal. Nothing is posted until you confirm one batched GitHub review.</Text>
      <EmptySuggestions status={status} count={suggestions.length} />
      {suggestions.map((suggestion) => (
        <SuggestionEditor key={suggestion.id} suggestion={suggestion} onChange={onChange} />
      ))}
      <SuggestionSubmit count={suggestions.length} readyCount={ready.length} blocked={blocked} posting={posting} onPost={onPost} />
    </DetailSection>
  )
}

function EmptySuggestions({ status, count }: { status: string; count: number }) {
  if (count) return null
  const active = ['starting', 'running'].includes(status)
  return (
    <Text style={styles.muted}>
      {active ? 'Suggestions will appear when the review completes.' : 'This review did not produce safe inline suggestions.'}
    </Text>
  )
}

function SuggestionSubmit({
  count,
  readyCount,
  blocked,
  posting,
  onPost,
}: {
  count: number
  readyCount: number
  blocked: boolean
  posting: boolean
  onPost(): void
}) {
  if (!count) return null
  const disabled = posting || !readyCount || blocked
  return (
    <>
      {blocked ? <Text style={styles.error}>Deselect deleted-line proposals or add a comment to every selected proposal.</Text> : null}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPost} style={[styles.primaryButton, disabled && styles.disabled]}>
        <Text style={styles.primaryButtonText}>{posting ? 'Posting…' : `Post ${readyCount} as one review`}</Text>
      </Pressable>
    </>
  )
}

function SuggestionEditor({
  suggestion,
  onChange,
}: {
  suggestion: MobileReviewSuggestion
  onChange(id: number, patch: Partial<MobileReviewSuggestion>): void
}) {
  const immutable = Boolean(suggestion.postedAt)
  return (
    <View style={styles.suggestion}>
      <View style={styles.suggestionHeader}>
        <View style={styles.actionOptionCopy}>
          <Text selectable style={styles.filePath}>{suggestion.path}:{suggestion.line}</Text>
          <Text style={styles.inputHint}>{suggestion.side === 'RIGHT' ? 'Current file line' : 'Deleted line'}</Text>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: suggestion.selected, disabled: immutable }}
          disabled={immutable}
          onPress={() => onChange(suggestion.id, { selected: !suggestion.selected })}
          style={[styles.secondaryButton, suggestion.selected && styles.optionSelected, immutable && styles.disabled]}
        >
          <Text style={styles.secondaryButtonText}>{immutable ? 'Posted' : suggestion.selected ? 'Selected' : 'Skipped'}</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel={`Review comment for ${suggestion.path}:${suggestion.line}`}
        editable={!immutable}
        multiline
        placeholder="Explain the proposed change…"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.compactTextarea]}
        value={suggestion.description}
        onChangeText={(description) => onChange(suggestion.id, { description })}
      />
      <TextInput
        accessibilityLabel={`Replacement for ${suggestion.path}:${suggestion.line}`}
        editable={!immutable}
        multiline
        placeholder="Replacement code (optional)"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.compactTextarea, styles.code]}
        value={suggestion.replacement}
        onChangeText={(replacement) => onChange(suggestion.id, { replacement })}
      />
    </View>
  )
}

function ThreadChanges({ detail }: { detail: MobileThreadDetails }) {
  return (
    <>
      <DetailSection title="Change summary" meta={`${detail.files.length} files`}>
        <View style={styles.metrics}>
          <DetailMetric label="FILES" value={detail.files.length} />
          <DetailMetric label="ADDITIONS" value={`+${detail.additions}`} />
          <DetailMetric label="DELETIONS" value={`-${detail.deletions}`} />
        </View>
        {detail.files.map((file) => <ThreadChangedFile key={file.path} file={file} />)}
        {!detail.files.length ? <Text style={styles.muted}>No changed files have been recorded yet.</Text> : null}
        {detail.diffError ? <Text style={styles.error}>{detail.diffError}</Text> : null}
      </DetailSection>
      {detail.diff ? (
        <DetailSection title="Diff">
          <MobileDiff patch={detail.diff} />
        </DetailSection>
      ) : null}
    </>
  )
}

function ThreadChangedFile({ file }: { file: MobileThreadDetails['files'][number] }) {
  return (
    <View style={styles.fileRow}>
      <Text numberOfLines={2} style={styles.filePath}>{file.path}</Text>
      <Text style={styles.additions}>+{file.additions}</Text>
      <Text style={styles.deletions}>−{file.deletions}</Text>
    </View>
  )
}

function ThreadContext({ detail }: { detail: MobileThreadDetails }) {
  return (
    <>
      <DetailSection title="Run context">
        <View style={styles.metrics}>
          <DetailMetric label="STATUS" value={detail.status} />
          <DetailMetric label="AGENT" value={detail.agentName} />
          <DetailMetric label="KIND" value={mobileThreadKind(detail)} />
        </View>
        <Text selectable style={styles.muted}>{detail.fullName}</Text>
        {detail.worktreePath ? <Text selectable style={styles.code}>{detail.worktreePath}</Text> : null}
        {detail.model || detail.reasoningEffort ? (
          <Text style={styles.muted}>{[detail.model, detail.reasoningEffort].filter(Boolean).join(' · ')}</Text>
        ) : null}
      </DetailSection>
      <DetailSection title="Original prompt">
        <MobileMarkdown content={detail.prompt} emptyText="Prompt unavailable." />
      </DetailSection>
      {detail.content ? (
        <DetailSection title="Raw run log">
          <Text selectable numberOfLines={160} style={styles.code}>{detail.content}</Text>
        </DetailSection>
      ) : null}
    </>
  )
}

function duration(startValue: string, endValue: string): string {
  const start = Date.parse(startValue)
  const end = endValue ? Date.parse(endValue) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unknown'
  const minutes = Math.max(0, Math.round((end - start) / 60_000))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function workspaceName(detail: MobileThreadDetails): string {
  return detail.worktreePath.split('/').filter(Boolean).at(-1) || detail.fullName.split('/').at(-1) || 'Agent worktree'
}
