import { useEffect, useState } from 'react'
import { Container } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { PreviewSettings } from './settings-types'

export function WorktreePreviewSettings({ settings, onSaved }: { settings: PreviewSettings; onSaved: (value: PreviewSettings) => void }) {
  const [domain, setDomain] = useState(settings.domain)
  const [gatewayPort, setGatewayPort] = useState(String(settings.gatewayPort))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDomain(settings.domain)
    setGatewayPort(String(settings.gatewayPort))
  }, [settings.domain, settings.gatewayPort])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const saved = await api<PreviewSettings>('/api/settings/worktree-previews', {
        method: 'POST',
        body: JSON.stringify({ domain, gatewayPort: Number(gatewayPort) }),
      })
      onSaved(saved)
      toast.success(saved.domain ? `Preview gateway ready on *.${saved.domain}:${saved.gatewayPort}` : 'Worktree preview gateway disabled')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const prerequisite = (
    <div className="min-w-0 break-words rounded-md border border-info/25 bg-info/[.05] p-3 text-[11px] leading-relaxed text-muted-foreground">
      <strong className="text-foreground">DNS prerequisite.</strong> Point{' '}
      <code className="break-all">*.{domain || 'previews.example.com'}</code> to this VertexADE host and allow TCP port{' '}
      {gatewayPort || '4180'}. Every detected service receives its own hostname. Each service with a port also receives <code>PORT</code>{' '}
      set to its internal container port.
    </div>
  )
  return (
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-3 sm:p-4">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Container className="size-4" />
          Worktree container previews
        </CardTitle>
        <CardDescription className="hidden sm:block">
          Run PR and Work-item worktrees as isolated containers behind one wildcard-domain gateway. VertexADE detects Tilt, Compose,
          Dockerfiles, simple Moon tasks, and dependency-aware Moon application plus devtool environments.
        </CardDescription>
      </CardHeader>
      <form onSubmit={save} className="min-w-0 space-y-3 p-3 sm:p-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-3">
          <Label className="min-w-0 flex-col items-stretch gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Wildcard base domain</span>
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              autoComplete="off"
              placeholder="previews.example.com"
            />
          </Label>
          <Label className="min-w-0 flex-col items-stretch gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Gateway port</span>
            <Input
              required
              type="number"
              min={1024}
              max={65535}
              value={gatewayPort}
              onChange={(event) => setGatewayPort(event.target.value)}
            />
          </Label>
        </div>
        <details className="rounded-md border sm:hidden">
          <summary className="cursor-pointer px-3 py-2 text-xs">DNS and routing requirements</summary>
          <div className="border-t p-2">{prerequisite}</div>
        </details>
        <div className="hidden sm:block">{prerequisite}</div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:justify-between">
          <p className="hidden min-w-0 text-[11px] text-muted-foreground sm:block">
            Repository files stay the source of truth; generated orchestration and Moon execution stay inside Docker.
          </p>
          <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={busy}>
            {busy ? 'Starting gateway…' : 'Save preview gateway'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
