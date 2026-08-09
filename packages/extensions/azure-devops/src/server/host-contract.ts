import type { ExtensionHostServices, PlanningTaskServices } from '@vertexade/platform-contracts'

export type AzurePlanningTaskServices = PlanningTaskServices

export type AzureExtensionHostServices = ExtensionHostServices<AzurePlanningTaskServices>
