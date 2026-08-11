import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { loadMobileWorkItemDetails, updateMobileWorkState, type MobileWorkItemDetails, type MobileWorkState } from '@/mobile-detail-service'
import { openMobileHttpUrl } from '@/mobile-linking'
import type { MobileThread, MobileWorkItem } from '@/mobile-workspace-service'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailMetric, DetailRow, DetailSection, MobileDetailShell } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'
import { useMobileDetail } from './use-mobile-detail'

type WorkDetailTab = 'overview' | 'threads' | 'activity' | 'links'
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'threads', label: 'Threads' },
  { id: 'activity', label: 'Activity' },
  { id: 'links', label: 'Links' },
] satisfies Array<{ id: WorkDetailTab; label: string }>
const states: MobileWorkState[] = ['backlog', 'active', 'review', 'deploy', 'done']

export function MobileWorkDetail({
  serviceUrl,
  item,
  onBack,
  onClose,
  onChanged,
  onOpenThread,
  onStartThread,
}: {
  serviceUrl: string
  item: MobileWorkItem
  onBack?: () => void
  onClose(): void
  onChanged(message: string): Promise<void>
  onOpenThread(thread: MobileThread): void
  onStartThread(item: MobileWorkItem): void
}) {
  const [tab, setTab] = useState<WorkDetailTab>('overview')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const loader = useCallback(() => loadMobileWorkItemDetails(serviceUrl, item), [item, serviceUrl])
  const detail = useMobileDetail(`work:${item.backendId}:${item.id}`, loader)

  async function move(state: MobileWorkState) {
    setSaving(true)
    setActionError('')
    try {
      await updateMobileWorkState(serviceUrl, item, state)
      await detail.refresh()
      await onChanged(`${item.key} moved to ${state}.`)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not move this Work item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <MobileDetailShell<WorkDetailTab>
      eyebrow={`${item.backendName.toUpperCase()} · ${item.key}`}
      title={detail.value?.title || item.title}
      subtitle={`${detail.value?.state || item.state} · ${detail.value?.repositoryNames.join(', ') || 'No repository'}`}
      tabs={tabs}
      activeTab={tab}
      loading={detail.loading}
      error={detail.error}
      onTab={setTab}
      onBack={onBack}
      onClose={onClose}
      onRetry={() => void detail.refresh()}
    >
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {detail.value ? (
        <WorkTabContent
          tab={tab}
          detail={detail.value}
          saving={saving}
          onError={setActionError}
          onMove={(state) => void move(state)}
          onOpenThread={onOpenThread}
          onStartThread={() => onStartThread(detail.value!)}
        />
      ) : null}
    </MobileDetailShell>
  )
}

function WorkTabContent({
  tab,
  detail,
  saving,
  onError,
  onMove,
  onOpenThread,
  onStartThread,
}: {
  tab: WorkDetailTab
  detail: MobileWorkItemDetails
  saving: boolean
  onError(message: string): void
  onMove(state: MobileWorkState): void
  onOpenThread(thread: MobileThread): void
  onStartThread(): void
}) {
  if (tab === 'threads') return <WorkThreads detail={detail} onOpenThread={onOpenThread} onStartThread={onStartThread} />
  if (tab === 'activity') return <WorkActivity detail={detail} />
  if (tab === 'links') return <WorkLinks detail={detail} onError={onError} />
  return <WorkOverview detail={detail} saving={saving} onMove={onMove} onStartThread={onStartThread} />
}

function WorkOverview({
  detail,
  saving,
  onMove,
  onStartThread,
}: {
  detail: MobileWorkItemDetails
  saving: boolean
  onMove(state: MobileWorkState): void
  onStartThread(): void
}) {
  return (
    <>
      <DetailSection title="Outcome">
        <MobileMarkdown content={detail.description} emptyText="No description has been added." />
        <View style={styles.metrics}>
          <DetailMetric label="THREADS" value={detail.threads.length} />
          <DetailMetric label="LINKS" value={detail.resources.length} />
          <DetailMetric label="EVENTS" value={detail.events.length} />
        </View>
        <Text style={styles.muted}>
          {detail.kind.replaceAll('_', ' ')} · {detail.priority} priority
          {detail.owner ? ` · ${detail.owner}` : ''}
        </Text>
        {detail.attention ? <Text style={styles.error}>{detail.attention}</Text> : null}
      </DetailSection>
      <DetailSection title="Lifecycle" meta={saving ? 'Saving…' : detail.state}>
        <View style={styles.actions}>
          {states.map((state) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: state === detail.state }}
              disabled={saving || state === detail.state}
              key={state}
              onPress={() => onMove(state)}
              style={[styles.secondaryButton, state === detail.state && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>{state}</Text>
            </Pressable>
          ))}
        </View>
      </DetailSection>
      <DetailSection title="Next action">
        <Pressable accessibilityRole="button" onPress={onStartThread} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Start agent thread</Text>
        </Pressable>
      </DetailSection>
      {detail.contextTransfers.length ? (
        <DetailSection title="Context transfers" meta={`${detail.contextTransfers.length}`}>
          {detail.contextTransfers.map((transfer, index) => (
            <DetailRow
              key={transfer.id}
              first={index === 0}
              title={transfer.instruction || `Transfer ${transfer.id}`}
              text={transfer.error}
              meta={`${transfer.status} · ${formatDate(transfer.createdAt)}`}
            />
          ))}
        </DetailSection>
      ) : null}
    </>
  )
}

function WorkThreads({
  detail,
  onOpenThread,
  onStartThread,
}: {
  detail: MobileWorkItemDetails
  onOpenThread(thread: MobileThread): void
  onStartThread(): void
}) {
  return (
    <DetailSection title="Agent threads" meta={`${detail.threads.length}`}>
      <Pressable accessibilityRole="button" onPress={onStartThread} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Start another thread</Text>
      </Pressable>
      {detail.threads.length ? (
        detail.threads.map((thread, index) => (
          <DetailRow
            testID={`detail-thread-${thread.backendId}-${thread.id}`}
            key={thread.id}
            first={index === 0}
            title={thread.taskTitle || thread.fullName}
            text={thread.latestActivity}
            meta={`${thread.agentName} · ${thread.status} · ${formatDate(thread.activityAt)}`}
            onPress={() => onOpenThread(thread)}
          />
        ))
      ) : (
        <Text style={styles.muted}>No agent threads yet.</Text>
      )}
    </DetailSection>
  )
}

function WorkActivity({ detail }: { detail: MobileWorkItemDetails }) {
  return (
    <DetailSection title="Timeline" meta={`${detail.events.length} events`}>
      {detail.events.length ? (
        detail.events.map((event, index) => (
          <DetailRow
            key={event.id}
            first={index === 0}
            title={event.summary}
            text={event.type.replaceAll('_', ' ')}
            meta={`${event.actor} · ${formatDate(event.createdAt)}`}
          />
        ))
      ) : (
        <Text style={styles.muted}>No recorded activity.</Text>
      )}
    </DetailSection>
  )
}

function WorkLinks({ detail, onError }: { detail: MobileWorkItemDetails; onError(message: string): void }) {
  return (
    <>
      <DetailSection title="Resources" meta={`${detail.resources.length}`}>
        {detail.resources.length ? (
          detail.resources.map((resource, index) => (
            <DetailRow
              key={`${resource.id}:${resource.role}`}
              first={index === 0}
              title={resource.label}
              text={`${resource.kind.replaceAll('_', ' ')} · ${resource.role}${resource.state ? ` · ${resource.state}` : ''}`}
              meta={resource.primary ? 'Primary' : undefined}
              onPress={resource.url ? () => void openMobileHttpUrl(resource.url, onError) : undefined}
            />
          ))
        ) : (
          <Text style={styles.muted}>No linked resources.</Text>
        )}
      </DetailSection>
      {detail.relations.length ? (
        <DetailSection title="Related Work" meta={`${detail.relations.length}`}>
          {detail.relations.map((relation, index) => (
            <DetailRow
              key={`${relation.key}:${relation.relation}`}
              first={index === 0}
              title={`${relation.key} · ${relation.title}`}
              text={relation.relation.replaceAll('_', ' ')}
              meta={relation.state}
            />
          ))}
        </DetailSection>
      ) : null}
    </>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
