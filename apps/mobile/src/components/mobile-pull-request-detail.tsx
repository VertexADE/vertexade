import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ensureMobilePullRequestWork, loadMobilePullRequestDetails, type MobilePullRequestDetails } from '@/mobile-detail-service'
import { openMobileHttpUrl } from '@/mobile-linking'
import type { MobilePullRequest } from '@/mobile-workspace-service'
import { MobileFileChanges } from './mobile-file-changes'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailMetric, DetailRow, DetailSection, MobileDetailShell } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'
import { useMobileDetail } from './use-mobile-detail'

type PullRequestTab = 'overview' | 'conversation' | 'checks' | 'commits' | 'changes'
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'checks', label: 'Checks' },
  { id: 'commits', label: 'Commits' },
  { id: 'changes', label: 'Changes' },
] satisfies Array<{ id: PullRequestTab; label: string }>

export function MobilePullRequestDetail({
  serviceUrl,
  pullRequest,
  onBack,
  onClose,
  onDismiss,
  visible,
  onChanged,
}: {
  serviceUrl: string
  pullRequest: MobilePullRequest
  onBack?: () => void
  onClose(): void
  onDismiss?(): void
  visible?: boolean
  onChanged(message: string): Promise<void>
}) {
  const [tab, setTab] = useState<PullRequestTab>('overview')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const loader = useCallback(() => loadMobilePullRequestDetails(serviceUrl, pullRequest), [pullRequest, serviceUrl])
  const detail = useMobileDetail(`pr:${pullRequest.backendId}:${pullRequest.repoId}:${pullRequest.number}`, loader)

  async function addToWork() {
    setBusy(true)
    setActionError('')
    try {
      const item = await ensureMobilePullRequestWork(serviceUrl, pullRequest)
      const message = `${item.key} is linked to this pull request.`
      setNotice(message)
      await onChanged(message)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not add this pull request to Work')
    } finally {
      setBusy(false)
    }
  }

  return (
    <MobileDetailShell<PullRequestTab>
      eyebrow={`${pullRequest.backendName.toUpperCase()} · ${pullRequest.fullName} #${pullRequest.number}`}
      title={detail.value?.title || pullRequest.title}
      subtitle={`${pullRequest.headRef || 'head'} → ${pullRequest.baseRef || 'base'}`}
      tabs={tabs}
      activeTab={tab}
      loading={detail.loading}
      error={detail.error}
      onTab={setTab}
      onBack={onBack}
      onClose={onClose}
      onDismiss={onDismiss}
      visible={visible}
      onRetry={() => void detail.refresh()}
    >
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {detail.value ? (
        <PullRequestTabContent
          tab={tab}
          detail={detail.value}
          linkedWork={Boolean(pullRequest.workItemId)}
          busy={busy}
          onError={setActionError}
          onAddToWork={() => void addToWork()}
        />
      ) : null}
    </MobileDetailShell>
  )
}

function PullRequestTabContent({
  tab,
  detail,
  linkedWork,
  busy,
  onError,
  onAddToWork,
}: {
  tab: PullRequestTab
  detail: MobilePullRequestDetails
  linkedWork: boolean
  busy: boolean
  onError(message: string): void
  onAddToWork(): void
}) {
  if (tab === 'conversation') return <PullRequestConversation detail={detail} />
  if (tab === 'checks') return <PullRequestChecks detail={detail} onError={onError} />
  if (tab === 'commits') return <PullRequestCommits detail={detail} />
  if (tab === 'changes') return <PullRequestChanges detail={detail} />
  return <PullRequestOverview detail={detail} linkedWork={linkedWork} busy={busy} onError={onError} onAddToWork={onAddToWork} />
}

function PullRequestOverview({
  detail,
  linkedWork,
  busy,
  onError,
  onAddToWork,
}: {
  detail: MobilePullRequestDetails
  linkedWork: boolean
  busy: boolean
  onError(message: string): void
  onAddToWork(): void
}) {
  return (
    <>
      <PullRequestDecision detail={detail} />
      <PullRequestDescription body={detail.body} />
      <PullRequestActions detail={detail} linkedWork={linkedWork} busy={busy} onError={onError} onAddToWork={onAddToWork} />
    </>
  )
}

function PullRequestDecision({ detail }: { detail: MobilePullRequestDetails }) {
  return (
    <DetailSection title="Decision" meta={detail.providerName}>
      <PullRequestDecisionBadges detail={detail} />
      <View style={styles.metrics}>
        <DetailMetric label="FILES" value={detail.changedFiles} />
        <DetailMetric label="ADDITIONS" value={`+${detail.additions}`} />
        <DetailMetric label="DELETIONS" value={`-${detail.deletions}`} />
        <DetailMetric label="COMMITS" value={detail.commits.length} />
      </View>
      <PullRequestPeople detail={detail} />
      <PullRequestLabels labels={detail.labels} />
    </DetailSection>
  )
}

function PullRequestDecisionBadges({ detail }: { detail: MobilePullRequestDetails }) {
  const state = detail.draft ? 'Draft' : 'Open'
  const decision = detail.reviewDecision || 'Review pending'
  const mergeState = detail.mergeState || detail.mergeable || 'Merge state unknown'
  return (
    <View style={styles.badges}>
      <Text style={styles.badge}>{state}</Text>
      <Text style={styles.badge}>{decision}</Text>
      <Text style={styles.badge}>{mergeState}</Text>
      {detail.unresolvedThreads ? <Text style={[styles.badge, styles.badgeDanger]}>{detail.unresolvedThreads} unresolved</Text> : null}
    </View>
  )
}

function PullRequestPeople({ detail }: { detail: MobilePullRequestDetails }) {
  const author = detail.author.name || detail.author.login || 'Unknown'
  const assigned = detail.assignees.map((person) => person.login).join(', ')
  return (
    <Text style={styles.muted}>
      Author: {author}
      {assigned ? ` · Assigned: ${assigned}` : ''}
    </Text>
  )
}

function PullRequestLabels({ labels }: { labels: MobilePullRequestDetails['labels'] }) {
  if (!labels.length) return null
  return (
    <View style={styles.badges}>
      {labels.map((label) => (
        <Text key={label.name} style={styles.badge}>
          {label.name}
        </Text>
      ))}
    </View>
  )
}

function PullRequestDescription({ body }: { body: string }) {
  return (
    <DetailSection title="Description">
      <MobileMarkdown content={body} emptyText="No pull request description." />
    </DetailSection>
  )
}

function PullRequestActions({
  detail,
  linkedWork,
  busy,
  onError,
  onAddToWork,
}: {
  detail: MobilePullRequestDetails
  linkedWork: boolean
  busy: boolean
  onError(message: string): void
  onAddToWork(): void
}) {
  const unavailable = busy || linkedWork
  const label = linkedWork ? 'Already in Work' : busy ? 'Adding…' : 'Add to Work'
  return (
    <DetailSection title="Actions">
      <View style={styles.actions}>
        {detail.url ? (
          <Pressable accessibilityRole="link" onPress={() => void openMobileHttpUrl(detail.url, onError)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open in {detail.providerName || 'source control'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={unavailable}
          onPress={onAddToWork}
          style={[styles.secondaryButton, unavailable && styles.disabled]}
        >
          <Text style={styles.secondaryButtonText}>{label}</Text>
        </Pressable>
      </View>
    </DetailSection>
  )
}

function PullRequestConversation({ detail }: { detail: MobilePullRequestDetails }) {
  return (
    <DetailSection title="Conversation" meta={`${detail.conversation.length} entries`}>
      {detail.conversation.length ? (
        detail.conversation.map((comment, index) => (
          <DetailRow
            key={comment.id}
            first={index === 0}
            title={comment.author}
            text={<MobileMarkdown content={comment.body || comment.state} emptyText="No comment body." />}
            meta={formatDate(comment.createdAt)}
          />
        ))
      ) : (
        <Text style={styles.muted}>No comments or reviews yet.</Text>
      )}
    </DetailSection>
  )
}

function PullRequestChecks({ detail, onError }: { detail: MobilePullRequestDetails; onError(message: string): void }) {
  return (
    <DetailSection title="Checks" meta={`${detail.checks.length}`}>
      {detail.checks.length ? (
        detail.checks.map((check, index) => (
          <DetailRow
            key={`${check.name}:${index}`}
            first={index === 0}
            title={check.name}
            text={check.status}
            onPress={check.url ? () => void openMobileHttpUrl(check.url, onError) : undefined}
          />
        ))
      ) : (
        <Text style={styles.muted}>No checks reported.</Text>
      )}
    </DetailSection>
  )
}

function PullRequestCommits({ detail }: { detail: MobilePullRequestDetails }) {
  return (
    <DetailSection title="Commits" meta={`${detail.commits.length}`}>
      {detail.commits.map((commit, index) => (
        <DetailRow
          key={commit.oid || String(index)}
          first={index === 0}
          title={commit.title || commit.oid.slice(0, 8)}
          text={commit.body}
          meta={`${commit.authors.map((author) => author.login).join(', ')} · ${formatDate(commit.authoredAt)}`}
        />
      ))}
    </DetailSection>
  )
}

function PullRequestChanges({ detail }: { detail: MobilePullRequestDetails }) {
  return (
    <DetailSection title="Changes" meta={`${detail.files.length} files`}>
      <MobileFileChanges additions={detail.additions} deletions={detail.deletions} files={detail.files} patch={detail.diff} />
    </DetailSection>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
