import type { VertexADEDesktopBridge } from '@vertexade/platform-contracts'

declare global {
  interface Window {
    vertexadeDesktop?: VertexADEDesktopBridge
  }
}

export function desktopBridge(): VertexADEDesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.vertexadeDesktop
  return bridge?.platform === 'desktop' ? bridge : null
}
