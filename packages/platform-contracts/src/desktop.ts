export const DESKTOP_BRIDGE_GLOBAL = 'vertexadeDesktop' as const

export const DESKTOP_ONBOARDING_CHANNELS = {
  status: 'desktop:onboarding:status',
  complete: 'desktop:onboarding:complete',
} as const

export const DESKTOP_DIALOG_CHANNELS = {
  chooseDirectory: 'desktop:dialog:choose-directory',
} as const

export const DESKTOP_UPDATE_CHANNELS = {
  status: 'desktop:update:status',
  check: 'desktop:update:check',
  install: 'desktop:update:install',
} as const

export type DesktopUpdateStatus = {
  supported: boolean
  currentVersion: string
  state: 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error'
  availableVersion: string | null
  message: string | null
}

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
  readonly dialog: {
    chooseDirectory(): Promise<string | null>
  }
  readonly updates: {
    status(): Promise<DesktopUpdateStatus>
    check(): Promise<DesktopUpdateStatus>
    install(): Promise<void>
  }
}
