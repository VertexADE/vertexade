export const DESKTOP_BRIDGE_GLOBAL = 'vertexadeDesktop' as const

export const DESKTOP_ONBOARDING_CHANNELS = {
  status: 'desktop:onboarding:status',
  complete: 'desktop:onboarding:complete',
} as const

export type DesktopOnboardingState = {
  currentVersion: number
  completedVersion: number | null
  completedAt: string | null
  completed: boolean
}

export type VertexADEDesktopBridge = {
  readonly platform: 'desktop'
  readonly onboarding: {
    status(): Promise<DesktopOnboardingState>
    complete(): Promise<DesktopOnboardingState>
  }
}
