import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Copy, KeyRound, Link2, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import type { MobilePairingInvitation, MobilePairingStatus } from '@vertexade/platform-contracts'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@vertexade/ui/components/ui/field'
import { InputGroup, InputGroupButton, InputGroupInput } from '@vertexade/ui/components/ui/input-group'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Status, StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { api } from '@vertexade/ui/lib/dashboard-api'

type PairingRuntimeStatus = {
  web: { currentHost: string; currentPort: number }
  webOrigins: string[]
  restartRequired: boolean
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function deviceLastUsed(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000))
  if (minutes < 2) return 'Active just now'
  if (minutes < 60) return `Active ${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `Active ${hours} hours ago` : `Active ${Math.round(hours / 24)} days ago`
}

function PairingReachability({ runtime }: { runtime: PairingRuntimeStatus | null }) {
  const reachable = Boolean(runtime?.webOrigins.length)
  return (
    <StatusPanel tone={reachable ? 'info' : 'warning'}>
      <Wifi />
      <StatusPanelContent>
        <StatusPanelTitle>{reachable ? 'Desktop is reachable from another device' : 'Expose the web listener first'}</StatusPanelTitle>
        <StatusPanelDescription>
          {reachable
            ? `The running web gateway is available on ${runtime?.webOrigins.join(', ')}.`
            : 'Set the web bind host to 0.0.0.0 (or a specific LAN/Tailscale address), save, and restart VertexADE Desktop. Keep the API listener on 127.0.0.1.'}
        </StatusPanelDescription>
      </StatusPanelContent>
    </StatusPanel>
  )
}

function OriginSuggestions({ suggestions, onSelect }: { suggestions: string[]; onSelect(origin: string): void }) {
  if (!suggestions.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Detected:</span>
      {suggestions.map((origin) => (
        <Button key={origin} type="button" size="xs" variant="outline" onClick={() => onSelect(origin)}>
          {origin}
        </Button>
      ))}
    </div>
  )
}

function InvitationStatus({
  invitation,
  activeInvitationExpiresAt,
  onCopy,
}: {
  invitation: MobilePairingInvitation | null
  activeInvitationExpiresAt: string | null
  onCopy(): void
}) {
  if (invitation) {
    return (
      <StatusPanel tone="success">
        <Check />
        <StatusPanelContent>
          <StatusPanelTitle>Ready to open on the iPhone</StatusPanelTitle>
          <StatusPanelDescription>
            <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-background/75 p-2 text-xs text-foreground">
              {invitation.pairUrl}
            </code>
            <span className="mt-2 flex items-center gap-1.5">
              <Clock3 /> Expires {displayTime(invitation.expiresAt)} and works once.
            </span>
          </StatusPanelDescription>
        </StatusPanelContent>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Copy pair link" onClick={onCopy}>
          <Copy />
        </Button>
      </StatusPanel>
    )
  }
  if (!activeInvitationExpiresAt || Date.parse(activeInvitationExpiresAt) <= Date.now()) return null
  return (
    <p className="text-[11px] text-muted-foreground">
      An invitation is active until {displayTime(activeInvitationExpiresAt)}. Its secret is not stored in recoverable form; generate a new
      link to display one.
    </p>
  )
}

function InvitationForm({
  publicOrigin,
  suggestions,
  invitation,
  activeInvitationExpiresAt,
  generating,
  onOriginChange,
  onGenerate,
  onCopy,
}: {
  publicOrigin: string
  suggestions: string[]
  invitation: MobilePairingInvitation | null
  activeInvitationExpiresAt: string | null
  generating: boolean
  onOriginChange(value: string): void
  onGenerate(event: React.FormEvent<HTMLFormElement>): void
  onCopy(): void
}) {
  return (
    <form onSubmit={onGenerate} className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <Field>
        <FieldLabel htmlFor="mobile-public-origin">Address the iPhone can reach</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="mobile-public-origin"
            type="url"
            required
            value={publicOrigin}
            onChange={(event) => onOriginChange(event.target.value)}
            placeholder="http://100.101.138.108:3773"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <InputGroupButton type="submit" disabled={generating}>
            {generating ? <Spinner /> : <Link2 />}
            Generate link
          </InputGroupButton>
        </InputGroup>
        <FieldDescription>Use an exact HTTP(S) origin with no path. The generated URL adds /pair#token= automatically.</FieldDescription>
      </Field>
      <OriginSuggestions suggestions={suggestions} onSelect={onOriginChange} />
      <InvitationStatus invitation={invitation} activeInvitationExpiresAt={activeInvitationExpiresAt} onCopy={onCopy} />
    </form>
  )
}

function PairedDevices({
  status,
  busyDeviceId,
  onRefresh,
  onRevoke,
}: {
  status: MobilePairingStatus | null
  busyDeviceId: string
  onRefresh(): void
  onRevoke(id: string, name: string): void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Paired devices</h3>
          <p className="text-[11px] text-muted-foreground">Each phone has its own revocable 90-day session stored in Keychain.</p>
        </div>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Refresh paired devices" onClick={onRefresh}>
          <RefreshCw />
        </Button>
      </div>
      <div className="divide-y rounded-lg border border-border/60">
        {status?.devices.map((device) => (
          <div key={device.id} className="flex items-center gap-3 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs">{device.name}</strong>
              <span className="block text-[11px] text-muted-foreground">
                {deviceLastUsed(device.lastUsedAt)} · expires {displayTime(device.expiresAt)}
              </span>
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busyDeviceId === device.id}
              aria-label={`Disconnect ${device.name}`}
              onClick={() => onRevoke(device.id, device.name)}
            >
              {busyDeviceId === device.id ? <Spinner /> : <Trash2 />}
            </Button>
          </div>
        ))}
        {status && status.devices.length === 0 && (
          <Empty className="m-2 min-h-32 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Smartphone />
              </EmptyMedia>
              <EmptyTitle>No phones paired</EmptyTitle>
              <EmptyDescription>Generate a one-time link above and open it on VertexADE Mobile.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}

export function MobilePairingSettings() {
  const [status, setStatus] = useState<MobilePairingStatus | null>(null)
  const [runtime, setRuntime] = useState<PairingRuntimeStatus | null>(null)
  const [publicOrigin, setPublicOrigin] = useState('')
  const [invitation, setInvitation] = useState<MobilePairingInvitation | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const [pairing, server] = await Promise.all([
        api<MobilePairingStatus>('/api/settings/mobile-pairing'),
        api<PairingRuntimeStatus>('/api/settings/server-runtime'),
      ])
      setStatus(pairing)
      setRuntime(server)
      setPublicOrigin((current) => current || pairing.publicOrigin || server.webOrigins[0] || '')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [])

  useEffect(() => void load(), [load])

  const suggestions = useMemo(() => runtime?.webOrigins.filter((origin) => origin !== publicOrigin) || [], [publicOrigin, runtime])

  async function generate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy('generate')
    try {
      const next = await api<MobilePairingInvitation>('/api/settings/mobile-pairing/invitations', {
        method: 'POST',
        body: JSON.stringify({ publicOrigin }),
      })
      setInvitation(next)
      await load()
      toast.success('One-time iPhone pair link created')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function copyPairLink(): Promise<void> {
    if (!invitation) return
    await navigator.clipboard.writeText(invitation.pairUrl)
    toast.success('Pair link copied')
  }

  async function revoke(id: string, name: string): Promise<void> {
    setBusy(id)
    try {
      const next = await api<MobilePairingStatus>(`/api/settings/mobile-pairing/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setStatus(next)
      toast.success(`${name} disconnected`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone /> Pair an iPhone
        </CardTitle>
        <CardDescription>Create a complete, one-time link that includes the reachable desktop address.</CardDescription>
        <CardAction>
          <Status tone="success">
            <ShieldCheck /> Cryptographic sessions
          </Status>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PairingReachability runtime={runtime} />
        <InvitationForm
          publicOrigin={publicOrigin}
          suggestions={suggestions}
          invitation={invitation}
          activeInvitationExpiresAt={status?.invitationExpiresAt || null}
          generating={busy === 'generate'}
          onOriginChange={setPublicOrigin}
          onGenerate={(event) => void generate(event)}
          onCopy={() => void copyPairLink()}
        />
        <PairedDevices status={status} busyDeviceId={busy} onRefresh={() => void load()} onRevoke={(id, name) => void revoke(id, name)} />
      </CardContent>
    </Card>
  )
}
