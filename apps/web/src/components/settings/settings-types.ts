import type { AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'

export type PreviewSettings = { domain: string; gatewayPort: number }
export type ContentGenerationSettings = AgentLaunchOptions & { permissionMode: 'read-only' }
export type ThreadRuntimeDefaults = { workItem: AgentLaunchOptions; review: AgentLaunchOptions }
