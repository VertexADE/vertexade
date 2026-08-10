export type DesktopPermissionRequest = {
  permission: string
  requestingUrl: string
  isMainFrame: boolean
}

export function desktopPermissionAllowed(request: DesktopPermissionRequest, applicationOrigin: string): boolean {
  if (!request.isMainFrame || request.permission !== 'clipboard-sanitized-write') return false
  try {
    return new URL(request.requestingUrl).origin === applicationOrigin
  } catch {
    return false
  }
}
