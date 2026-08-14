import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_BRIDGE_GLOBAL,
  DESKTOP_DIALOG_CHANNELS,
  DESKTOP_ONBOARDING_CHANNELS,
  DESKTOP_UPDATE_CHANNELS,
  type DesktopUpdateStatus,
  type DesktopOnboardingState,
  type VertexADEDesktopBridge,
} from '@vertexade/platform-contracts'

const bridge: VertexADEDesktopBridge = {
  platform: 'desktop',
  onboarding: {
    status: () => ipcRenderer.invoke(DESKTOP_ONBOARDING_CHANNELS.status) as Promise<DesktopOnboardingState>,
    complete: () => ipcRenderer.invoke(DESKTOP_ONBOARDING_CHANNELS.complete) as Promise<DesktopOnboardingState>,
  },
  dialog: {
    chooseDirectory: () => ipcRenderer.invoke(DESKTOP_DIALOG_CHANNELS.chooseDirectory) as Promise<string | null>,
  },
  updates: {
    status: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.status) as Promise<DesktopUpdateStatus>,
    check: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.check) as Promise<DesktopUpdateStatus>,
    install: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.install) as Promise<void>,
  },
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_GLOBAL, bridge)
