import type { MobilePullRequest, MobileThread, MobileWorkItem } from '@/mobile-workspace-service'
import { MobilePullRequestDetail } from './mobile-pull-request-detail'
import { MobileWorkDetail } from './mobile-work-detail'

export type MobileWorkspaceDetailSelection =
  | { kind: 'pullRequest'; value: MobilePullRequest }
  | { kind: 'work'; value: MobileWorkItem }

export function MobileWorkspaceDetail({
  serviceUrl,
  stack,
  onBack,
  onClose,
  onDismiss,
  visible,
  onChanged,
  onOpenThread,
  onStartThread,
}: {
  serviceUrl: string
  stack: MobileWorkspaceDetailSelection[]
  onBack(): void
  onClose(): void
  onDismiss?(): void
  visible?: boolean
  onChanged(message: string): Promise<void>
  onOpenThread(thread: MobileThread): void
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
    onDismiss={onDismiss}
    visible={visible}
    onChanged={onChanged}
  />
  if (selection.kind === 'work') return <MobileWorkDetail
    serviceUrl={serviceUrl}
    item={selection.value}
    onBack={back}
    onClose={onClose}
    onDismiss={onDismiss}
    visible={visible}
    onChanged={onChanged}
    onOpenThread={onOpenThread}
    onStartThread={onStartThread}
  />
  return null
}
