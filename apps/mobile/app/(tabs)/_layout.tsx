import { Redirect } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useMobileApp } from '@/components/mobile-app-context'
import { MobileWorkspaceProvider } from '@/components/mobile-workspace-context'
import { useMobileWorkspaceContext } from '@/components/mobile-workspace-context'
import { colors } from '@/theme'

export default function WorkspaceTabsLayout() {
  const app = useMobileApp()
  if (!app.connection) return <Redirect href="/" />

  return <MobileWorkspaceProvider connections={app.connection.connections}>
    <WorkspaceTabs />
  </MobileWorkspaceProvider>
}

function WorkspaceTabs() {
  const { workspace } = useMobileWorkspaceContext()
  const workCount = workspace.workItems.filter((item) => !item.archived).length
  const threadCount = workspace.threads.filter((thread) => !thread.archived).length

  return (
    <NativeTabs tintColor={colors.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'sparkles', selected: 'sparkles' }} />
        <NativeTabs.Trigger.Label>Focus</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="work">
        <NativeTabs.Trigger.Icon sf={{ default: 'checklist', selected: 'checklist.checked' }} />
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
        {workCount ? <NativeTabs.Trigger.Badge>{boundedCount(workCount)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="threads">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label>Threads</NativeTabs.Trigger.Label>
        {threadCount ? <NativeTabs.Trigger.Badge>{boundedCount(threadCount)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pull-requests">
        <NativeTabs.Trigger.Icon sf="arrow.triangle.branch" />
        <NativeTabs.Trigger.Label>PRs</NativeTabs.Trigger.Label>
        {workspace.pullRequests.length ? <NativeTabs.Trigger.Badge>{boundedCount(workspace.pullRequests.length)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}

function boundedCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
