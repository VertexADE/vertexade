import { useEffect, useState } from 'react'
import { Monitor, Plus, Server, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { api, platformBackendState } from '@vertexade/ui/lib/dashboard-api'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { readBrowserPairedServers, writeBrowserPairedServers, type BrowserPairedServer } from '../../lib/browser-pairing'

type Redemption = Pick<BrowserPairedServer, 'serviceUrl' | 'credentialId' | 'expiresAt' | 'namespace'>

export function BrowserPairingSettings() {
  const [servers, setServers] = useState<BrowserPairedServer[]>([])
  const [pairUrl, setPairUrl] = useState('')
  const [name, setName] = useState('')
  const [pairing, setPairing] = useState(false)
  const [backends, setBackends] = useState<BackendDescriptor[]>([])

  useEffect(() => {
    const stored = readBrowserPairedServers()
    setServers(stored)
    if (!stored.some((server) => server.sessionToken)) return
    void api<{ credentials: Array<{ serviceUrl: string; credentialId: string }> }>('/api/browser-pairing/migrate', { method: 'POST' })
      .then(({ credentials }) => {
        const byUrl = new Map(credentials.map((credential) => [credential.serviceUrl, credential.credentialId]))
        const migrated = stored.map(({ sessionToken: _sessionToken, ...server }) => ({
          ...server,
          credentialId: byUrl.get(server.serviceUrl) || server.credentialId,
        }))
        writeBrowserPairedServers(migrated)
        setServers(migrated)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const subscription = platformBackendState().subscribe(setBackends)
    return () => subscription.unsubscribe()
  }, [])

  function persist(next: BrowserPairedServer[]) {
    writeBrowserPairedServers(next)
    setServers(next)
  }

  async function pair() {
    setPairing(true)
    try {
      const redemption = await api<Redemption>('/api/browser-pairing/redeem', {
        method: 'POST',
        body: JSON.stringify({
          pairUrl: pairUrl.trim(),
          deviceName: pairingDeviceName(),
        }),
      })
      const server = pairedServer(redemption, name, servers)
      persist([...servers.filter((candidate) => candidate.serviceUrl !== server.serviceUrl), server])
      setName('')
      setPairUrl('')
      setPairing(false)
      toast.success(`${server.name} connected`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setPairing(false)
    }
  }

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>Workspace connections</CardTitle>
        <CardDescription>
          Local and remote VertexADE servers contribute to one workspace. Pair a server once, then use its work and extensions everywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="rounded-lg border border-border/60 bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void pair()
          }}
        >
          <FieldGroup className="md:grid-cols-[minmax(8rem,.7fr)_minmax(0,1.3fr)]">
            <Field>
              <FieldLabel htmlFor="paired-server-name">Connection name</FieldLabel>
              <Input
                id="paired-server-name"
                aria-label="Connection name"
                value={name}
                maxLength={80}
                placeholder="Studio server"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="paired-server-link">One-time pairing link</FieldLabel>
              <Input
                id="paired-server-link"
                aria-label="One-time pairing link"
                required
                value={pairUrl}
                placeholder="https://server.example/pair#token=…"
                onChange={(event) => setPairUrl(event.target.value)}
              />
            </Field>
            <Button className="self-end md:col-span-2 md:justify-self-end" type="submit" disabled={pairing || !pairUrl.trim()}>
              <Plus /> {pairing ? 'Pairing…' : 'Pair server'}
            </Button>
          </FieldGroup>
        </form>
        <div className="overflow-hidden rounded-lg border border-border/60">
          {backends
            .filter((backend) => backend.isDefault)
            .map((backend) => (
              <ConnectionRow key={backend.id} backend={backend} />
            ))}
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-3 border-t border-border/60 bg-background/35 p-3 first:border-t-0">
              <ConnectionIcon backend={backends.find((backend) => backend.id === server.id)} />
              <span className="min-w-0 flex-1">
                <Input
                  aria-label={`Connection name for ${server.serviceUrl}`}
                  className="h-7 border-transparent bg-transparent px-1 font-medium hover:border-border focus:border-border"
                  value={server.name}
                  onChange={(event) =>
                    setServers((current) =>
                      current.map((candidate) => (candidate.id === server.id ? { ...candidate, name: event.target.value } : candidate)),
                    )
                  }
                  onBlur={persistConnectionNames}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
                  <span className="truncate">{server.serviceUrl}</span>
                  <ConnectionStatus backend={backends.find((backend) => backend.id === server.id)} />
                </span>
              </span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Unpair ${server.name}`} onClick={() => void unpair(server)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {!servers.length ? <p className="border-t px-3 py-4 text-sm text-muted-foreground">No remote servers connected.</p> : null}
        </div>
      </CardContent>
    </Card>
  )

  async function unpair(server: BrowserPairedServer) {
    try {
      if (server.credentialId)
        await api(`/api/browser-pairing/credential?id=${encodeURIComponent(server.credentialId)}`, { method: 'DELETE' })
      persist(servers.filter((candidate) => candidate.id !== server.id))
      toast.success(`${server.name} disconnected`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  function persistConnectionNames() {
    try {
      persist(
        servers.map((server) => ({
          ...server,
          name: server.name.trim() || new URL(server.serviceUrl).host,
        })),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
}

function pairingDeviceName() {
  return navigator.userAgent.includes('Electron') ? 'VertexADE Desktop' : 'VertexADE Web'
}

function pairedServer(redemption: Redemption, requestedName: string, servers: BrowserPairedServer[]): BrowserPairedServer {
  const existing = servers.find((server) => server.serviceUrl === redemption.serviceUrl)
  const service = new URL(redemption.serviceUrl)
  const identity = connectionIdentity(existing, redemption, service.hostname, servers)
  return {
    ...redemption,
    ...identity,
    name: connectionName(requestedName, existing, service.host),
  }
}

function connectionIdentity(
  existing: BrowserPairedServer | undefined,
  redemption: Redemption,
  hostname: string,
  servers: BrowserPairedServer[],
) {
  if (existing) return { id: existing.id, namespace: existing.namespace }
  return { id: uniqueId(hostname, servers), namespace: redemption.namespace }
}

function connectionName(requested: string, existing: BrowserPairedServer | undefined, fallback: string) {
  for (const candidate of [requested.trim(), existing ? existing.name : '', fallback]) {
    if (candidate) return candidate
  }
  return fallback
}

function ConnectionIcon({ backend }: { backend?: BackendDescriptor }) {
  const connected = backend?.connected === true
  return (
    <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-muted/55 text-muted-foreground">
      <Server className="size-4" />
      <span
        className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${connected ? 'bg-success' : 'bg-warning'}`}
      />
    </span>
  )
}

function ConnectionStatus({ backend }: { backend?: BackendDescriptor }) {
  if (!backend) return <span className="shrink-0 text-warning">Connecting…</span>
  return (
    <span className={backend.connected ? 'shrink-0 text-success' : 'shrink-0 text-warning'}>{backend.connected ? 'Live' : 'Offline'}</span>
  )
}

function ConnectionRow({ backend }: { backend: BackendDescriptor }) {
  return (
    <div className="flex items-center gap-3 bg-background/35 p-3">
      <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Monitor className="size-4" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${backend.connected ? 'bg-success' : 'bg-warning'}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-xs">{backend.label}</strong>
        <span className="text-xs text-muted-foreground">
          This server · <ConnectionStatus backend={backend} />
        </span>
      </span>
    </div>
  )
}

function uniqueId(hostname: string, servers: BrowserPairedServer[]) {
  const base =
    hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'server'
  let id = base
  let suffix = 2
  while (servers.some((server) => server.id === id)) id = `${base.slice(0, 44)}-${suffix++}`
  return id
}
