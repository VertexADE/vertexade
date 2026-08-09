export const WIDE_DESKTOP_BREAKPOINT = 1440

export function desktopSidebarOpen(viewportWidth: number, preference?: boolean) {
  return preference ?? viewportWidth >= WIDE_DESKTOP_BREAKPOINT
}
