import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_BRIDGE_GLOBAL,
  DESKTOP_ONBOARDING_CHANNELS,
  type DesktopOnboardingState,
  type VertexADEDesktopBridge,
} from '@vertexade/platform-contracts'

const bridge: VertexADEDesktopBridge = {
  platform: 'desktop',
  onboarding: {
    status: () => ipcRenderer.invoke(DESKTOP_ONBOARDING_CHANNELS.status) as Promise<DesktopOnboardingState>,
    complete: () => ipcRenderer.invoke(DESKTOP_ONBOARDING_CHANNELS.complete) as Promise<DesktopOnboardingState>,
  },
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_GLOBAL, bridge)
