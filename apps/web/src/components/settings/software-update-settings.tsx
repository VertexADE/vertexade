import { useEffect, useState } from 'react'
import type { DesktopUpdateStatus, ServerUpdateInfo, VertexADEDesktopBridge } from '@vertexade/platform-contracts'
import { Check, Copy, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import { desktopBridge } from '../../lib/desktop-bridge'

export function SoftwareUpdateSettings({ backendId }: { backendId: string }) {
  const bridge = desktopBridge()
  return bridge ? <DesktopUpdateSettings bridge={bridge} /> : <ServerUpdateSettings backendId={backendId} />
}

function DesktopUpdateSettings({ bridge }: { bridge: VertexADEDesktopBridge }) {
  const [desktopStatus, setDesktopStatus] = useState<DesktopUpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void bridge.updates.status().then(setDesktopStatus).catch(showError)
  }, [bridge])

  async function checkDesktop() {
    setChecking(true)
    try {
      setDesktopStatus(await bridge.updates.check())
    } catch (error) {
      showError(error)
    } finally {
      setChecking(false)
    }
  }

  async function installDesktop() {
    try {
      await bridge.updates.install()
    } catch (error) {
      showError(error)
    }
  }

  const status = desktopStatus
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/55 p-4 sm:flex-row sm:items-center">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Download className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">VertexADE Desktop</strong>
          <Badge variant="outline">{status?.currentVersion ?? 'Loading…'}</Badge>
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{desktopStatusMessage(status)}</span>
      </span>
      {status?.state === 'ready' ? (
        <Button type="button" onClick={() => void installDesktop()}>
          <RefreshCw /> Restart and install
        </Button>
      ) : (
        <Button type="button" variant="outline" loading={checking} loadingText="Checking…" onClick={() => void checkDesktop()}>
          <RefreshCw /> Check for updates
        </Button>
      )}
    </div>
  )
}

function ServerUpdateSettings({ backendId }: { backendId: string }) {
  const [serverInfo, setServerInfo] = useState<ServerUpdateInfo | null>(null)
  const [showInstructions, setShowInstructions] = useState(false)

  useEffect(() => {
    let current = true
    setServerInfo(null)
    void backendApi<ServerUpdateInfo>(backendId, '/api/software-update')
      .then((value) => {
        if (current) setServerInfo(value)
      })
      .catch((error) => {
        if (current) showError(error)
      })
    return () => {
      current = false
    }
  }, [backendId])

  async function copyCommand() {
    if (!serverInfo) return
    await navigator.clipboard.writeText(serverInfo.command)
    toast.success('Update command copied')
  }

  if (!serverInfo) return <p className="text-sm text-muted-foreground">Loading server update information…</p>
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/55 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Download className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">VertexADE Server</strong>
            <Badge variant="outline">{serverInfo.currentVersion}</Badge>
            <Badge variant="secondary">{installationLabel(serverInfo.installation)}</Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">Updates are never executed by the server.</span>
        </span>
        <Button type="button" variant="outline" aria-expanded={showInstructions} onClick={() => setShowInstructions((value) => !value)}>
          <Download /> Update server
        </Button>
      </div>
      {showInstructions ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-muted/25 p-3">
          <p className="text-xs text-muted-foreground">Run this command in the environment that manages this server:</p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs">{serverInfo.command}</code>
            <Button type="button" size="icon-sm" variant="outline" aria-label="Copy update command" onClick={() => void copyCommand()}>
              <Copy />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{serverInfo.restartNote}</p>
          <Button asChild size="sm" variant="link" className="px-0">
            <a href={serverInfo.releaseUrl} target="_blank" rel="noreferrer">
              View latest release <ExternalLink />
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function desktopStatusMessage(status: DesktopUpdateStatus | null) {
  if (!status) return 'Loading update status…'
  if (!status.supported) return status.message ?? 'Updates require a signed packaged build.'
  const version = status.availableVersion ?? 'the latest version'
  const messages: Record<DesktopUpdateStatus['state'], string> = {
    idle: 'Check the signed release feed for a newer version.',
    checking: 'Checking the signed release feed…',
    current: 'You are running the latest available version.',
    downloading: `Downloading ${version}…`,
    ready: `${status.availableVersion ?? 'An update'} is ready to install.`,
    error: status.message ?? 'The update check failed.',
  }
  return messages[status.state]
}

function installationLabel(installation: ServerUpdateInfo['installation']) {
  if (installation === 'npm') return 'npm installation'
  if (installation === 'container') return 'Container installation'
  return 'Source checkout'
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error))
}
