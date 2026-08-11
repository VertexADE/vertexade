import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { Toaster } from '@vertexade/ui/components/ui/sonner'
import { TooltipProvider } from '@vertexade/ui/components/ui/tooltip'
import { AppNav } from '@vertexade/ui/components/app-nav'
import { ConfirmProvider } from '@vertexade/ui/components/confirm-provider'
import { ThemeProvider } from '@vertexade/ui/components/theme-provider'
import { DashboardDatabaseProvider } from '../lib/tanstack-dashboard-provider'
import { createPlatformQueryClient } from '../lib/platform-query-client'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
      { title: 'VertexADE' },
      {
        name: 'description',
        content: 'VertexADE — Vertex Agent Development Environment for coordinated engineering work.',
      },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const standalone = useRouterState({ select: (state) => ['/onboarding', '/pair'].includes(state.location.pathname) })
  const [queryClient] = useState(createPlatformQueryClient)
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <TooltipProvider>
              <ConfirmProvider>
                {standalone ? (
                  children
                ) : (
                  <DashboardDatabaseProvider>
                    <AppNav>{children}</AppNav>
                  </DashboardDatabaseProvider>
                )}
              </ConfirmProvider>
            </TooltipProvider>
            <Toaster richColors />
          </ThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
