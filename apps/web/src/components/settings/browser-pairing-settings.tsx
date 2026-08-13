import { useEffect, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { readBrowserPairedServers, writeBrowserPairedServers, type BrowserPairedServer } from '../../lib/browser-pairing'

type Redemption = Pick<BrowserPairedServer, 'serviceUrl' | 'sessionToken' | 'expiresAt'>

export function BrowserPairingSettings() {
  const [servers, setServers] = useState<BrowserPairedServer[]>([])
  const [pairUrl, setPairUrl] = useState('')
  const [name, setName] = useState('')
  const [pairing, setPairing] = useState(false)

  useEffect(() => setServers(readBrowserPairedServers()), [])

  function persist(next: BrowserPairedServer[], reload = false) {
    writeBrowserPairedServers(next)
    setServers(next)
    if (reload) window.location.reload()
  }

  async function pair() {
    setPairing(true)
    try {
      const [redemption, registry] = await Promise.all([
        api<Redemption>('/api/browser-pairing/redeem', {
          method: 'POST',
          body: JSON.stringify({
            pairUrl: pairUrl.trim(),
            deviceName: navigator.userAgent.includes('Electron') ? 'VertexADE Desktop' : 'VertexADE Web',
          }),
        }),
        api<{ backends: Array<{ namespace: number }> }>('/api/backends'),
      ])
      const existing = servers.find((server) => server.serviceUrl === redemption.serviceUrl)
      const namespace =
        existing?.namespace ||
        Math.max(0, ...servers.map((server) => server.namespace), ...registry.backends.map((backend) => backend.namespace)) + 1
      const id = existing?.id || uniqueId(new URL(redemption.serviceUrl).hostname, servers)
      const server: BrowserPairedServer = {
        ...redemption,
        id,
        namespace,
        name: name.trim() || existing?.name || new URL(redemption.serviceUrl).host,
      }
      persist([...servers.filter((candidate) => candidate.serviceUrl !== server.serviceUrl), server], true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setPairing(false)
    }
  }

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>Paired servers</CardTitle>
        <CardDescription>
          Pair each VertexADE server independently. Threads from every paired server appear in the unified workspace.
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
          <FieldGroup className="md:grid-cols-[minmax(10rem,.8fr)_minmax(18rem,1.7fr)_auto]">
            <Field>
              <FieldLabel htmlFor="paired-server-name">Connection name</FieldLabel>
              <Input
                id="paired-server-name"
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
                required
                value={pairUrl}
                placeholder="https://server.example/pair#token=…"
                onChange={(event) => setPairUrl(event.target.value)}
              />
            </Field>
            <Button className="self-end" type="submit" disabled={pairing || !pairUrl.trim()}>
              <Plus /> {pairing ? 'Pairing…' : 'Pair server'}
            </Button>
          </FieldGroup>
        </form>
        <div className="space-y-2">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/55 p-3">
              <Link2 className="size-4 text-emerald-500" />
              <span className="min-w-0 flex-1">
                <Input
                  aria-label={`Connection name for ${server.serviceUrl}`}
                  className="h-7 border-transparent bg-transparent px-1 font-medium hover:border-border focus:border-border"
                  value={server.name}
                  onChange={(event) =>
                    persist(
                      servers.map((candidate) => (candidate.id === server.id ? { ...candidate, name: event.target.value } : candidate)),
                    )
                  }
                  onBlur={() => window.location.reload()}
                />
                <span className="block truncate px-1 text-xs text-muted-foreground">{server.serviceUrl}</span>
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Unpair ${server.name}`}
                onClick={() =>
                  persist(
                    servers.filter((candidate) => candidate.id !== server.id),
                    true,
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!servers.length ? (
            <p className="py-5 text-center text-sm text-muted-foreground">No additional servers paired in this browser.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
