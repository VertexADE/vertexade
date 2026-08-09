import type { ExtensionHostServices as PlatformExtensionHostServices, PlanningTaskServices } from '@vertexade/platform-contracts'

export type DashboardExtensionHostServices = PlatformExtensionHostServices<PlanningTaskServices>
