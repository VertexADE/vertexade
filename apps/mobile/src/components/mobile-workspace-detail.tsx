import type { MobilePullRequest, MobileThread, MobileWorkItem } from '@/mobile-workspace-service'
import { MobilePullRequestDetail } from './mobile-pull-request-detail'
import { MobileThreadDetail } from './mobile-thread-detail'
import { MobileWorkDetail } from './mobile-work-detail'

export type MobileWorkspaceDetailSelection =
  | { kind: 'pullRequest'; value: MobilePullRequest }
  | { kind: 'work'; value: MobileWorkItem }
  | { kind: 'thread'; value: MobileThread }

export function MobileWorkspaceDetail({
  serviceUrl,
  stack,
  onBack,
  onClose,
  onChanged,
  onOpenThread,
  onOpenWorkId,
  onOpenThreadId,
  onOpenPullRequest,
  onStartThread,
}: {
  serviceUrl: string
  stack: MobileWorkspaceDetailSelection[]
  onBack(): void
  onClose(): void
  onChanged(message: string): Promise<void>
  onOpenThread(thread: MobileThread): void
  onOpenWorkId(backendId: string, workItemId: number): void
  onOpenThreadId(backendId: string, threadId: number): void
  onOpenPullRequest(backendId: string, fullName: string, number: number): void
  onStartThread(item: MobileWorkItem): void
}) {
  const selection = stack.at(-1)
  if (!selection) return null
  const back = stack.length > 1 ? onBack : undefined

  if (selection.kind === 'pullRequest') return <MobilePullRequestDetail
    serviceUrl={serviceUrl}
    pullRequest={selection.value}
    onBack={back}
    onClose={onClose}
    onChanged={onChanged}
  />
  if (selection.kind === 'work') return <MobileWorkDetail
    serviceUrl={serviceUrl}
    item={selection.value}
    onBack={back}
    onClose={onClose}
    onChanged={onChanged}
    onOpenThread={onOpenThread}
    onStartThread={onStartThread}
  />
  return <MobileThreadDetail
    key={`${selection.value.backendId}:${selection.value.id}`}
    serviceUrl={serviceUrl}
    thread={selection.value}
    onBack={back}
    onClose={onClose}
    onChanged={onChanged}
    onOpenThread={onOpenThread}
    onOpenWork={selection.value.workItemId ? () => onOpenWorkId(selection.value.backendId, selection.value.workItemId!) : undefined}
    onOpenThreadId={(threadId) => onOpenThreadId(selection.value.backendId, threadId)}
    onOpenPullRequest={(fullName, number) => onOpenPullRequest(selection.value.backendId, fullName, number)}
  />
}
