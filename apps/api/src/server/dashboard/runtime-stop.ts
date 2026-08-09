import { disposeConfiguredOutboundPolicy } from '@vertexade/platform-server/outbound-policy'
import type { DashboardEvents } from '../events/dashboard-events.ts'

type Stoppable = { stop(): void }
type Cleanup = { stopRecovery(): void }
type PreviewGateway = { stop(): Promise<void> }

export async function stopDashboardRuntimeResources(
  automationRecoveryTimer: ReturnType<typeof setInterval>,
  cleanup: Cleanup | undefined,
  readModel: Stoppable | undefined,
  events: DashboardEvents,
  previewGateway: PreviewGateway,
) {
  clearInterval(automationRecoveryTimer)
  cleanup?.stopRecovery()
  readModel?.stop()
  events.dispose()
  await previewGateway.stop()
  await disposeConfiguredOutboundPolicy()
}
