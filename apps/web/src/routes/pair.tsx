import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Copy, ExternalLink, Link2, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { mobilePairingDeepLink, pairingTokenFromHash } from '../lib/mobile-pair-link'

export const Route = createFileRoute('/pair')({ ssr: false, component: MobilePairingHandoff })

function MobilePairingHandoff() {
  const token = useMemo(() => pairingTokenFromHash(window.location.hash), [])
  const deepLink = token ? mobilePairingDeepLink(window.location.origin, token) : null

  const copyLink = async (): Promise<void> => {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Pair link copied')
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 sm:grid sm:place-items-center">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold">
          <span className="grid size-9 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Link2 className="size-4" />
          </span>
          VertexADE device pairing
        </div>
        <Card className="gap-0 overflow-hidden py-0 shadow-xl">
          <CardHeader className="border-b bg-gradient-to-br from-primary/[.10] via-card to-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Smartphone className="size-5" />
                  Open VertexADE Mobile
                </CardTitle>
                <CardDescription className="mt-2 leading-relaxed">
                  This one-time invitation connects the app to this desktop without copying a service URL or permanent token.
                </CardDescription>
              </div>
              <Badge variant="outline" className="shrink-0 border-emerald-500/35 text-emerald-400">
                <ShieldCheck /> One-time
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {deepLink ? (
              <>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    Make sure VertexADE Mobile is installed on this iPhone.
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    Tap below. The app will exchange this invitation once and save the session in Keychain.
                  </li>
                </ol>
                <Button className="w-full" size="lg" onClick={() => window.location.assign(deepLink)}>
                  Open VertexADE Mobile <ExternalLink />
                </Button>
                <Button className="w-full" variant="outline" onClick={() => void copyLink()}>
                  <Copy /> Copy this pair link
                </Button>
              </>
            ) : (
              <div className="rounded-lg border border-destructive/30 bg-destructive/[.06] p-4 text-sm">
                This pairing link is incomplete or malformed. Generate a new link in VertexADE Desktop Settings.
              </div>
            )}
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              The invitation expires after 10 minutes and can only be used once. It stays after the # in this page address so it is not sent
              in the initial web request.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
