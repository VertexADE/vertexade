import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Bot,
  Activity,
  Check,
  CircleAlert,
  Clipboard,
  GitFork,
  Loader2,
  PackageCheck,
  RefreshCw,
  Rocket,
  ServerCog,
  Settings2,
  TerminalSquare,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { CleanupWorktrees } from '@vertexade/ui/components/cleanup-worktrees'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Progress } from '@vertexade/ui/components/ui/progress'
import {
  StatusPanel,
  StatusPanelActions,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from '@vertexade/ui/components/ui/status'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import {
  Command,
  GuideCard,
  OperationalMetric,
  StatusDot,
  StatusLine,
  StatusList,
  StepNumber,
  type SetupTool,
} from '../components/setup/setup-components'
import { useDashboardMeta } from '../lib/dashboard-cache'

export const Route = createFileRoute('/setup')({ ssr: false, component: SetupPage })

type SetupStatus = {
  ready: boolean
  runtime: { nodeVersion: string; production: boolean }
  tools: SetupTool[]
  scm: {
    id: string
    name: string
    ready: boolean
    source: string
    connected: boolean
    error: string
  }
  agents: { id: string; name: string; enabled: boolean; ready: boolean; tool: SetupTool | null }[]
  extensions: {
    ready: number
    total: number
    modules: { id: string; name: string; lifecycle: string; configured?: boolean }[]
  }
  operations: {
    deployment: { commitSha?: string; deployedAt?: string; status?: string } | null
    process: { pid: number; uptimeSeconds: number; residentMemoryBytes: number }
    queues: { queuedFollowUps: number; queuedReviews: number; oldestQueuedReview: string | null }
    activity: { activeJobs: number; failedAutomations: number }
    automations: {
      paused: boolean
      activeRuns: number
      pendingApprovals: number
      staleRuns: number
      oldestActiveAt: string | null
    }
  } | null
}

// fallow-ignore-next-line complexity -- Existing setup checklist intentionally aggregates live health signals in one route.
function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const cleanupWorktrees = useDashboardMeta().value.cleanup_worktrees
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const nextStatus = await api<SetupStatus>('/api/setup/status')
      setStatus(nextStatus)
    } catch (error) {
      const message = (error as Error).message
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const milestones = useMemo(
    () =>
      status
        ? [
            { label: 'Application running', ready: true },
            {
              label: 'Core tools available',
              ready: status.tools.filter((tool) => tool.required).every((tool) => tool.ready),
            },
            { label: `${status.scm.name} connected`, ready: status.scm.ready },
            { label: 'Execution agent ready', ready: status.agents.some((agent) => agent.ready) },
          ]
        : [],
    [status],
  )
  const completed = milestones.filter((milestone) => milestone.ready).length
  const progress = milestones.length ? (completed / milestones.length) * 100 : 0
  const degraded = Boolean(
    status?.ready &&
    (status.extensions.ready < status.extensions.total ||
      status.operations?.activity.failedAutomations ||
      status.operations?.automations.staleRuns ||
      (status.operations?.deployment?.status && status.operations.deployment.status !== 'verified')),
  )
  const healthLabel = !status?.ready ? 'In progress' : degraded ? 'Attention' : 'Ready'

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={status ? 'Platform status' : 'Guided setup'}
        title={status ? 'System health' : 'Get VertexADE ready'}
        description={
          status?.ready
            ? 'Monitor the runtime, connected providers, execution agents, and extension health from one place.'
            : 'Follow the live checklist from workstation prerequisites to your first agent-powered repository workflow.'
        }
        actions={
          <Button variant="outline" size="sm" disabled={loading} aria-label="Check system health again" onClick={() => void load()}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            <span className="hidden sm:inline">Check again</span>
          </Button>
        }
      />
      {loadError && (
        <StatusPanel tone="danger" className="mb-4">
          <CircleAlert />
          <StatusPanelContent>
            <StatusPanelTitle>System health could not be loaded</StatusPanelTitle>
            <StatusPanelDescription>{loadError}</StatusPanelDescription>
          </StatusPanelContent>
          <StatusPanelActions>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw />
              Retry
            </Button>
          </StatusPanelActions>
        </StatusPanel>
      )}
      <div className="mb-5 rounded-lg border border-border/75 bg-card/65 px-3 py-3 shadow-[0_1px_1px_rgba(0,0,0,.03)] backdrop-blur-sm sm:px-4 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="text-sm">
              {status?.ready
                ? degraded
                  ? 'Ready with follow-ups'
                  : 'Ready to create work'
                : `${completed} of ${milestones.length || 4} essentials ready`}
            </strong>
            <p className="mt-0.5 text-xs text-muted-foreground">Optional extensions and PM2 can be configured later.</p>
          </div>
          <Badge
            variant="outline"
            className={cn(status?.ready && !degraded ? 'border-emerald-500/40 text-emerald-400' : 'border-amber-500/40 text-amber-400')}
          >
            {healthLabel}
          </Badge>
        </div>
        <Progress value={progress} className="mt-3 h-1.5" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {milestones.map((milestone) => (
            <div
              key={milestone.label}
              className={cn('flex items-center gap-1.5 text-xs', milestone.ready ? 'text-emerald-400' : 'text-muted-foreground')}
            >
              {milestone.ready ? <Check className="size-3" /> : <span className="size-2.5 rounded-full border" />}
              {milestone.label}
            </div>
          ))}
        </div>
      </div>

      {status?.ready && degraded && (
        <StatusPanel tone="warning" className="mb-4">
          <CircleAlert />
          <StatusPanelContent>
            <StatusPanelTitle>Review background services</StatusPanelTitle>
            <StatusPanelDescription>
              Agent work can continue. Resolve failed or stale background activity before relying on unattended automation.
            </StatusPanelDescription>
          </StatusPanelContent>
          <StatusPanelActions className="flex-wrap">
            {Boolean(status.operations?.activity.failedAutomations || status.operations?.automations.staleRuns) && (
              <Button asChild size="sm">
                <Link to="/automations" search={{ tab: 'runs', activity: 'history' }}>
                  <Activity />
                  Inspect automation history
                </Link>
              </Button>
            )}
            {status.extensions.ready < status.extensions.total && (
              <Button asChild variant="outline" size="sm">
                <Link to="/extensions">
                  <PackageCheck />
                  Review extensions
                </Link>
              </Button>
            )}
            {status.operations?.deployment?.status !== 'verified' && (
              <Button asChild variant="outline" size="sm">
                <Link to="/deployments" search={{ status: undefined, q: undefined, target: undefined }}>
                  <Rocket />
                  Review delivery
                </Link>
              </Button>
            )}
          </StatusPanelActions>
        </StatusPanel>
      )}

      {!status && loading ? (
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground">
          <span>
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Inspecting this installation…
          </span>
        </div>
      ) : (
        status && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,.78fr)]">
            <div className="min-w-0 space-y-4">
              {status.ready && <CleanupWorktrees worktrees={cleanupWorktrees} />}
              <details open={!status.ready} className="group rounded-lg border bg-card/35">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <strong className="block text-sm">{status.ready ? 'Setup and repair guide' : 'Complete setup'}</strong>
                    <span className="text-xs text-muted-foreground">
                      {status.ready ? 'Commands and connection steps for maintenance.' : 'Follow each step to make the workspace ready.'}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-primary group-open:hidden">Show</span>
                  <span className="hidden text-xs font-medium text-primary group-open:inline">Hide</span>
                </summary>
                <div className="space-y-4 border-t p-3 sm:p-4">
                  <GuideCard
                    number="1"
                    icon={Wrench}
                    title="Install pinned tools with mise (recommended)"
                    description="mise installs the Node.js and pnpm versions declared by this repository and keeps upgrades reproducible. You can still install them manually."
                    ready={Boolean(status.tools.find((tool) => tool.id === 'mise')?.ready)}
                  >
                    <Command value="mise trust && mise install" />
                    <StatusList items={status.tools.filter((tool) => tool.id === 'mise')} />
                    <p className="text-xs text-muted-foreground">
                      Install mise from <code className="text-foreground">https://mise.jdx.dev/getting-started.html</code>, reopen your
                      shell, then run the command above from the VertexADE checkout.
                    </p>
                  </GuideCard>

                  <GuideCard
                    number="2"
                    icon={TerminalSquare}
                    title="Prepare the cloned repository"
                    description="The interactive command checks prerequisites, installs exact dependencies, and runs the quality gates."
                  >
                    <Command value="pnpm setup" />
                    <p className="text-xs text-muted-foreground">
                      For automation, use <code className="text-foreground">pnpm setup --yes</code>. To inspect without changing anything,
                      use <code className="text-foreground">pnpm setup:check</code>.
                    </p>
                  </GuideCard>

                  <GuideCard
                    number="3"
                    icon={Wrench}
                    title="Confirm core tools"
                    description={`The running server uses ${status.runtime.nodeVersion}. Node.js 22.13+, pnpm, and Git are required; mise is the recommended version manager.`}
                    ready={status.tools.filter((tool) => tool.required).every((tool) => tool.ready)}
                  >
                    <StatusList items={status.tools.filter((tool) => tool.required)} />
                  </GuideCard>

                  <GuideCard
                    number="4"
                    icon={GitFork}
                    title={`Connect ${status.scm.name}`}
                    description="Repository discovery, pull requests, checks, and deployment data need an authenticated source-control provider."
                    ready={status.scm.ready}
                  >
                    <StatusLine
                      ready={status.scm.ready}
                      title={
                        status.scm.ready
                          ? `Connected via ${status.scm.source || 'provider credentials'}`
                          : `${status.scm.name} authentication needs attention`
                      }
                      detail={
                        status.scm.error ||
                        (status.scm.ready
                          ? 'The server can use the selected source-control identity.'
                          : 'Configure authentication in the selected source-control extension.')
                      }
                    />
                    <Button asChild variant="outline" size="sm">
                      <Link to="/extensions">
                        <Settings2 />
                        Open {status.scm.name} extension
                      </Link>
                    </Button>
                  </GuideCard>

                  <GuideCard
                    number="5"
                    icon={Bot}
                    title="Choose an execution agent"
                    description="Only one agent is required. Install and authenticate the provider you want to launch."
                    ready={status.agents.some((agent) => agent.ready)}
                  >
                    <div className="grid gap-2 sm:grid-cols-3">
                      {status.agents.map((agent) => (
                        <div
                          key={agent.id}
                          className={cn('rounded-lg border p-3', agent.ready && 'border-emerald-500/30 bg-emerald-500/[.04]')}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-xs">{agent.name}</strong>
                            <StatusDot ready={agent.ready} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {agent.ready ? agent.tool?.detail : agent.tool?.install}
                          </p>
                        </div>
                      ))}
                    </div>
                  </GuideCard>

                  <GuideCard
                    number="6"
                    icon={PackageCheck}
                    title="Configure extensions"
                    description="Bundled extensions are already installed. Enable only what belongs in this workspace and finish each connection there."
                    ready={status.extensions.ready > 0}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {status.extensions.modules.map((module) => (
                        <Badge
                          key={module.id}
                          variant="outline"
                          className={cn(
                            module.lifecycle === 'ready' && 'border-emerald-500/30 text-emerald-400',
                            ['setup-required', 'degraded'].includes(module.lifecycle) && 'border-amber-500/30 text-amber-400',
                          )}
                        >
                          {module.name} · {module.lifecycle.replace('-', ' ')}
                        </Badge>
                      ))}
                    </div>
                    <Button asChild size="sm">
                      <Link to="/extensions">
                        <PackageCheck />
                        Open Extension store
                      </Link>
                    </Button>
                  </GuideCard>
                </div>
              </details>
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
              {status.operations && (
                <Card className="gap-0 overflow-hidden py-0">
                  <CardHeader className="border-b p-4">
                    <CardTitle className="flex items-center gap-2 font-mono text-sm">
                      <Activity className="size-4" />
                      System health
                    </CardTitle>
                    <CardDescription>Live runtime, deployment, and durable queue state.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 p-4 text-xs">
                    <OperationalMetric
                      label="Deployed commit"
                      value={status.operations.deployment?.commitSha?.slice(0, 12) || 'Unrecorded'}
                    />
                    <OperationalMetric label="API uptime" value={`${Math.floor(status.operations.process.uptimeSeconds / 60)} min`} />
                    <OperationalMetric
                      label="API memory"
                      value={`${Math.round(status.operations.process.residentMemoryBytes / 1024 / 1024)} MB`}
                    />
                    <OperationalMetric label="Active jobs" value={String(status.operations.activity.activeJobs)} />
                    <OperationalMetric label="Queued reviews" value={String(status.operations.queues.queuedReviews)} />
                    <OperationalMetric label="Queued follow-ups" value={String(status.operations.queues.queuedFollowUps)} />
                    <OperationalMetric
                      label="Automation runtime"
                      value={status.operations.automations.paused ? 'Paused' : 'Running'}
                      warning={status.operations.automations.paused}
                    />
                    <OperationalMetric label="Active automations" value={String(status.operations.automations.activeRuns)} />
                    <OperationalMetric
                      label="Pending approvals"
                      value={String(status.operations.automations.pendingApprovals)}
                      warning={status.operations.automations.pendingApprovals > 0}
                    />
                    <OperationalMetric
                      label="Stale automations"
                      value={String(status.operations.automations.staleRuns)}
                      warning={status.operations.automations.staleRuns > 0}
                    />
                    <OperationalMetric
                      label="Failed automations"
                      value={String(status.operations.activity.failedAutomations)}
                      warning={status.operations.activity.failedAutomations > 0}
                    />
                    <OperationalMetric
                      label="Deployment"
                      value={status.operations.deployment?.status || 'Not verified'}
                      warning={status.operations.deployment?.status !== 'verified'}
                    />
                  </CardContent>
                </Card>
              )}

              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b p-4">
                  <CardTitle className="flex items-center gap-2 font-mono text-sm">
                    <ServerCog className="size-4" />
                    Run mode
                  </CardTitle>
                  <CardDescription>Use development while configuring, then switch to a production build.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  <StatusLine
                    ready={status.runtime.production}
                    title={status.runtime.production ? 'Production mode' : 'Development mode'}
                    detail={
                      status.runtime.production
                        ? 'The optimized application is running.'
                        : 'Hot reload is active; use a production build for persistent hosting.'
                    }
                  />
                  <Command label="Development" value="pnpm dev" />
                  <Command label="Production" value="pnpm build && pnpm start" />
                  <Command
                    label="Persistent PM2"
                    value="cp -n ecosystem.config.example.cjs ecosystem.config.cjs && pm2 start ecosystem.config.cjs && pm2 save"
                  />
                </CardContent>
              </Card>

              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b p-4">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Rocket className="size-4" />
                    Next outcome
                  </CardTitle>
                  <CardDescription>Prove the complete flow after setup.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4 text-xs text-muted-foreground">
                  <ol className="space-y-2">
                    <li className="flex gap-2">
                      <StepNumber value="1" />
                      Add a repository from Settings.
                    </li>
                    <li className="flex gap-2">
                      <StepNumber value="2" />
                      Create a Work item for a concrete outcome.
                    </li>
                    <li className="flex gap-2">
                      <StepNumber value="3" />
                      Launch one agent run and confirm its worktree appears.
                    </li>
                  </ol>
                  <Button asChild className="w-full">
                    <Link to="/work">Go to Work</Link>
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        )
      )}
    </WorkspacePage>
  )
}
