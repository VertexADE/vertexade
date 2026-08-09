import { useCallback, useEffect, useState } from 'react'
import { Container, ExternalLink, Loader2, Play, RefreshCw, Square, Terminal, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'

type PreviewStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
type PreviewAction = 'start' | 'restart' | 'stop'
type PreviewPort = {
  containerPort: number
  hostPort: number
  protocol: 'tcp' | 'udp'
  hostname: string
  url: string | null
}
type PreviewService = {
  name: string
  containerId: string
  containerName: string
  status: string
  ports: PreviewPort[]
  source?: string
  project?: string
  task?: string
}
type PreviewTool = { id: string; name: string; sourceFile: string; version?: string }
type PreviewLog = { name: string; content: string }
type WorktreePreview = {
  status: PreviewStatus
  manifest: {
    source: string
    sourceFile: string
    tools?: PreviewTool[]
    warnings: string[]
    services: PreviewService[]
  } | null
  error: string | null
  progress: string | null
  updated_at: string | null
}

const actionPath: Record<PreviewAction, string> = {
  start: '/start',
  restart: '/restart',
  stop: '/stop',
}
const actionMessage: Record<PreviewAction, string> = {
  start: 'Building isolated preview',
  restart: 'Rebuilding isolated preview',
  stop: 'Stopping isolated preview',
}
const startable = new Set<PreviewStatus>(['idle', 'stopped', 'failed'])
const statusClass: Partial<Record<PreviewStatus, string>> = {
  running: 'border-emerald-500/40 text-emerald-400',
  failed: 'border-red-500/40 text-red-400',
}

function useWorktreePreview(threadId: number) {
  const [preview, setPreview] = useState<WorktreePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<PreviewLog[]>([])
  const base = `/api/extensions/container-preview/agent-threads/${threadId}`
  const load = useCallback(async () => setPreview(await api<WorktreePreview>(base)), [base])
  useEffect(() => {
    let active = true
    api<WorktreePreview>(base)
      .then((value) => {
        if (active) setPreview(value)
      })
      .catch((error) => toast.error(error.message))
    return () => {
      active = false
    }
  }, [base])
  useEffect(() => {
    if (!preview || !['starting', 'stopping'].includes(preview.status)) return
    const timer = setInterval(() => void load().catch(() => undefined), 1500)
    return () => clearInterval(timer)
  }, [load, preview?.status])
  const action = async (name: PreviewAction) => {
    setBusy(true)
    try {
      setPreview(await api<WorktreePreview>(`${base}${actionPath[name]}`, { method: 'POST', body: '{}' }))
      setLogs([])
      toast.success(actionMessage[name])
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const showLogs = async () => {
    setBusy(true)
    try {
      setLogs((await api<{ services: PreviewLog[] }>(`${base}/logs`)).services)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { preview, busy, logs, action, showLogs }
}

function PreviewHeader({ preview }: { preview: WorktreePreview | null }) {
  const status = preview ? preview.status : 'loading'
  const className = status === 'loading' ? undefined : statusClass[status]
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <strong className="flex items-center gap-2 text-sm">
          <Container className="size-4 text-cyan-400" />
          Isolated worktree preview
        </strong>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          VertexADE detects repository tools and container definitions, then builds services in containers. Complex Moon workspaces are
          assembled from application dependencies, devtool Compose stacks, Dockerfiles, and safe local preview configuration.
        </p>
      </div>
      <Badge variant="outline" className={cn('capitalize', className)}>
        {status}
      </Badge>
    </div>
  )
}

type PreviewControlProps = {
  busy: boolean
  onAction: (name: PreviewAction) => void
  onLogs: () => void
}

function StartPreviewControl({ busy, onAction }: PreviewControlProps) {
  return (
    <Button size="sm" disabled={busy} onClick={() => onAction('start')}>
      <Play />
      Build and start
    </Button>
  )
}

function RunningPreviewControls({ busy, onAction, onLogs }: PreviewControlProps) {
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('restart')}>
        <RefreshCw />
        Rebuild
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('stop')}>
        <Square />
        Stop
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onLogs}>
        <Terminal />
        Logs
      </Button>
    </>
  )
}

function TransitionPreviewControl({ status }: { status: 'starting' | 'stopping' }) {
  const label = status === 'starting' ? 'Detecting and building…' : 'Stopping…'
  return (
    <Button size="sm" disabled>
      <Loader2 className="animate-spin" />
      {label}
    </Button>
  )
}

function PreviewControls({ preview, busy, onAction, onLogs }: { preview: WorktreePreview | null } & PreviewControlProps) {
  const status = preview ? preview.status : 'idle'
  if (startable.has(status)) return <StartPreviewControl busy={busy} onAction={onAction} onLogs={onLogs} />
  if (status === 'running') return <RunningPreviewControls busy={busy} onAction={onAction} onLogs={onLogs} />
  return <TransitionPreviewControl status={status as 'starting' | 'stopping'} />
}

function PreviewServiceCard({ service }: { service: PreviewService }) {
  const links = service.ports.filter((port) => port.url)
  return (
    <article className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <strong className="text-xs">{service.name}</strong>
          {service.project && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {service.task ? `moon run ${service.project}:${service.task}` : service.project}
            </p>
          )}
        </div>
        <span className="font-mono text-xs capitalize text-muted-foreground">{service.status}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {links.map((port) => (
          <a
            key={`${port.containerPort}/${port.protocol}`}
            href={port.url!}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ExternalLink />
            {port.url!.replace(/^https?:\/\//, '')}
            <span className="font-mono text-xs text-muted-foreground">container :{port.containerPort}</span>
          </a>
        ))}
        {!links.length && <span className="text-xs text-muted-foreground">Internal dependency · no preview URL</span>}
      </div>
    </article>
  )
}

function PreviewTools({ tools = [] }: { tools?: PreviewTool[] }) {
  if (!tools.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-3 py-2">
      <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Wrench className="size-3" />
        Toolchain
      </span>
      {tools.map((tool) => (
        <Badge key={tool.id} variant="outline" title={tool.sourceFile} className="font-mono text-xs font-normal">
          {tool.name}
          {tool.version ? ` ${tool.version}` : ''}
        </Badge>
      ))}
    </div>
  )
}

function PreviewServices({ preview }: { preview: WorktreePreview }) {
  if (!preview.manifest) return null
  const { services, source, sourceFile, tools, warnings } = preview.manifest
  return (
    <div className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <strong className="text-xs">Detected services</strong>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {source} · {sourceFile}
          </p>
        </div>
        <Badge variant="secondary">
          {services.length} container{services.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <PreviewTools tools={tools} />
      <div className="divide-y">
        {services.map((service) => (
          <PreviewServiceCard key={service.containerId} service={service} />
        ))}
      </div>
      {warnings.length > 0 && <div className="border-t bg-amber-500/[.04] p-3 text-xs text-amber-400">{warnings.join(' · ')}</div>}
    </div>
  )
}

function PreviewLogs({ logs }: { logs: PreviewLog[] }) {
  return (
    <>
      {logs.map((service) => (
        <div key={service.name} className="overflow-hidden rounded-xl border bg-slate-950">
          <div className="border-b border-white/10 px-3 py-2 font-mono text-xs text-slate-300">{service.name} · last 200 lines</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-slate-300">
            {service.content || 'No log output.'}
          </pre>
        </div>
      ))}
    </>
  )
}

export function WorktreePreviewPanel({ threadId }: { threadId: number }) {
  const { preview, busy, logs, action, showLogs } = useWorktreePreview(threadId)
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="rounded-xl border bg-background p-4 shadow-xs">
        <PreviewHeader preview={preview} />
        <div className="mt-4 flex flex-wrap gap-2">
          <PreviewControls preview={preview} busy={busy} onAction={(name) => void action(name)} onLogs={() => void showLogs()} />
        </div>
        {preview?.status === 'starting' && preview.progress && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/[.05] p-3 text-xs text-cyan-300">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 break-words font-mono">{preview.progress}</span>
          </div>
        )}
        {preview?.error && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg border border-red-500/30 bg-red-500/[.05] p-3 text-xs text-red-400">
            {preview.error}
          </p>
        )}
      </div>
      {preview && <PreviewServices preview={preview} />}
      <PreviewLogs logs={logs} />
    </div>
  )
}
