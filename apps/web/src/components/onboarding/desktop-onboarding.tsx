import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DesktopOnboardingState, VertexADEDesktopBridge } from '@vertexade/platform-contracts'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  GitBranch,
  GitPullRequest,
  Layers3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  TerminalSquare,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
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
import { api } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import { desktopBridge } from '../../lib/desktop-bridge'
import { parseSetupStatus, setupMilestones, type SetupMilestone, type SetupStatus } from '../../lib/setup-status'

export type DesktopOnboardingDestination = 'workspace' | 'setup'

export function desktopOnboardingDestinationPath(destination: DesktopOnboardingDestination): '/' | '/setup' {
  return destination === 'setup' ? '/setup' : '/'
}

type DesktopOnboardingProps = {
  onComplete(destination: DesktopOnboardingDestination): void
}

type OnboardingStep = {
  id: 'welcome' | 'work' | 'threads' | 'pull-requests' | 'setup'
  eyebrow: string
  title: string
  shortTitle: string
  description: string
  icon: LucideIcon
}

export const desktopOnboardingSteps: OnboardingStep[] = [
  {
    id: 'welcome',
    eyebrow: 'Welcome to VertexADE',
    title: 'One place to move engineering work forward',
    shortTitle: 'Welcome',
    description: 'Turn an outcome into agent work, inspect every change, and carry it through pull-request review.',
    icon: Sparkles,
  },
  {
    id: 'work',
    eyebrow: 'Guide · Work items',
    title: 'Start with the outcome, not the tool',
    shortTitle: 'Work items',
    description: 'A Work item keeps the request, repository, agent runs, review work, and delivery evidence together.',
    icon: Layers3,
  },
  {
    id: 'threads',
    eyebrow: 'Guide · Threads',
    title: 'Follow the work as it happens',
    shortTitle: 'Threads',
    description: 'Threads are the durable conversation and execution history behind each piece of work.',
    icon: MessageSquareText,
  },
  {
    id: 'pull-requests',
    eyebrow: 'Guide · Pull requests',
    title: 'Review the complete change, not just a list row',
    shortTitle: 'Pull requests',
    description: 'Open a full PR overview for checks, review state, discussion, commits, files, diffs, and next actions.',
    icon: GitPullRequest,
  },
  {
    id: 'setup',
    eyebrow: 'Desktop setup',
    title: 'Connect the tools VertexADE will use',
    shortTitle: 'Setup',
    description: 'Confirm source control, at least one execution agent, and the local tools needed by your repositories.',
    icon: Settings2,
  },
]

function GuideFeature({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden border-border/65 bg-card/65 py-0 shadow-[0_16px_45px_rgba(0,0,0,.08)]">
      <CardHeader className="border-b border-border/50 bg-muted/20 p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 text-sm leading-6 text-muted-foreground">{children}</CardContent>
    </Card>
  )
}

function NumberedList({ items }: { items: Array<{ title: string; detail: string }> }) {
  return (
    <ol className="grid gap-3">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-3 rounded-xl border border-border/55 bg-background/55 p-3.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 font-mono text-xs font-semibold text-primary">
            {index + 1}
          </span>
          <span className="min-w-0">
            <strong className="block text-sm text-foreground">{item.title}</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function WelcomeGuide() {
  return (
    <div className="grid gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[.12] via-card/80 to-card p-5 sm:p-7">
        <div className="absolute -right-12 -top-16 size-56 rounded-full bg-primary/10 blur-3xl" />
        <Badge variant="outline" className="border-primary/30 bg-primary/[.06] text-primary">
          Desktop workspace
        </Badge>
        <h2 className="mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Plan, delegate, inspect, and ship without losing the engineering story.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          VertexADE connects the outcome you want with the agent conversations, code changes, pull requests, reviews, and evidence that
          deliver it.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
          {[
            { icon: Layers3, label: 'Work item', detail: 'Define the outcome' },
            { icon: MessageSquareText, label: 'Agent threads', detail: 'Build and review' },
            { icon: GitPullRequest, label: 'Pull request', detail: 'Verify and deliver' },
          ].map(({ icon: Icon, label, detail }, index) => (
            <div key={label} className="contents">
              <div className="rounded-xl border border-border/60 bg-background/60 p-3.5">
                <Icon className="size-4 text-primary" />
                <strong className="mt-2 block text-sm">{label}</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
              </div>
              {index < 2 && <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:block" />}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <GuideFeature icon={Workflow} title="A connected workflow">
          Context follows the work from request to agent run to review, so you can understand why a change exists.
        </GuideFeature>
        <GuideFeature icon={GitBranch} title="Isolated execution">
          Agent work runs in dedicated worktrees, keeping concurrent changes separate from your main checkout.
        </GuideFeature>
        <GuideFeature icon={Check} title="Evidence before confidence">
          Review code, checks, discussions, and delivery status from the same workspace before deciding what happens next.
        </GuideFeature>
      </div>
    </div>
  )
}

function WorkGuide() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.78fr)]">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-5">
          <CardTitle className="text-base">Create a complete Work item</CardTitle>
          <CardDescription>Press N anywhere in the workspace, or choose New work from the sidebar.</CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <NumberedList
            items={[
              { title: 'Describe the outcome', detail: 'Write the result you want, important constraints, and what proves completion.' },
              { title: 'Choose the repository', detail: 'VertexADE creates isolated worktrees from a repository registered in Settings.' },
              { title: 'Tune the run', detail: 'Choose an agent, model, reasoning level, permissions, and reusable instructions.' },
              {
                title: 'Create or start immediately',
                detail: 'Save the Work item for later, or launch its first agent thread in the same action.',
              },
            ]}
          />
        </CardContent>
      </Card>
      <div className="grid content-start gap-3">
        <GuideFeature icon={Layers3} title="The Work overview">
          Track the current stage, all implementation and review threads, linked pull requests, blockers, evidence, and follow-up actions.
        </GuideFeature>
        <GuideFeature icon={Bot} title="More than one run">
          Start another implementation thread, request an independent review, or continue a stopped run without creating a separate task.
        </GuideFeature>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
          <strong className="block text-sm text-foreground">Useful shortcut</strong>
          <span className="mt-1 block">
            Press <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-foreground">G</kbd> then{' '}
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-foreground">W</kbd> to open Work.
          </span>
        </div>
      </div>
    </div>
  )
}

function ThreadsGuide() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <GuideFeature icon={MessageSquareText} title="Read the whole conversation">
          Agent output is rendered as Markdown with code, tables, links, and structured tool activity instead of a raw terminal transcript.
        </GuideFeature>
        <GuideFeature icon={GitBranch} title="Inspect changes in context">
          Review the thread’s changed files and Vercel-style diffs alongside the reasoning and commands that produced them.
        </GuideFeature>
        <GuideFeature icon={Bot} title="Continue deliberately">
          Send a follow-up, answer an input request, adjust runtime options, or launch a separate review thread while preserving history.
        </GuideFeature>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-5">
          <CardTitle className="text-base">A thread is an execution record</CardTitle>
          <CardDescription>Use it to understand what ran, what changed, what stopped, and what still needs a decision.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
          {[
            ['Timeline', 'Messages, tool calls, progress, approvals, and failures remain ordered and inspectable.'],
            ['Runtime', 'The agent, model, reasoning effort, service tier, permissions, and worktree remain visible.'],
            ['Changes', 'Changed-file summaries and diffs connect implementation details to the conversation.'],
            ['Recovery', 'Stopped and failed work can be continued with its context instead of being recreated from memory.'],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-xl border border-border/55 bg-background/55 p-4">
              <strong className="text-sm">{title}</strong>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function PullRequestsGuide() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(18rem,.74fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <GuideFeature icon={GitPullRequest} title="Triage the queue">
          Filter and group pull requests by repository, author, review state, checks, draft status, or the server that owns them.
        </GuideFeature>
        <GuideFeature icon={Bot} title="Bring an agent into review">
          Start a review thread from a PR, inspect its findings, and keep the review work linked to the change it assessed.
        </GuideFeature>
        <GuideFeature icon={Rocket} title="Act with the full picture">
          Approve, request changes, merge, or follow external links only after checking the gates and evidence that matter.
        </GuideFeature>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-5">
          <CardTitle className="text-base">Inside a pull-request overview</CardTitle>
          <CardDescription>The detailed workspace keeps review signals together instead of scattering them across tabs.</CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <NumberedList
            items={[
              {
                title: 'Summary and merge state',
                detail: 'See authorship, branches, draft state, mergeability, approvals, and the current decision.',
              },
              { title: 'Checks and evidence', detail: 'Inspect CI conclusions, validation evidence, impact analysis, and blocked gates.' },
              {
                title: 'Conversation and reviews',
                detail: 'Read review decisions, comments, and unresolved feedback with Markdown formatting.',
              },
              {
                title: 'Commits, files, and diffs',
                detail: 'Navigate the exact file changes in a readable split or unified diff presentation.',
              },
              {
                title: 'Linked work and threads',
                detail: 'Move back to the originating Work item or open the implementation and review history.',
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SetupMilestoneCard({ milestone }: { milestone: SetupMilestone }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3.5',
        milestone.ready ? 'border-emerald-500/25 bg-emerald-500/[.05]' : 'border-amber-500/25 bg-amber-500/[.05]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
          milestone.ready ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400',
        )}
      >
        {milestone.ready ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
      </span>
      <span>
        <strong className="block text-sm">{milestone.label}</strong>
        <span className="mt-0.5 block text-xs text-muted-foreground">{milestone.ready ? 'Ready' : 'Needs attention'}</span>
      </span>
    </div>
  )
}

function namesOrFallback(names: string[], fallback: string): string {
  return names.length ? names.join(', ') : fallback
}

function sourceControlStatus(status: SetupStatus['scm']): string {
  if (!status.ready) return status.error || 'Not connected'
  return `${status.name} connected via ${status.source || 'configured credentials'}`
}

function setupReadinessLabel(ready: boolean, completed: number): { headline: string; badge: string; badgeClass: string } {
  if (ready) return { headline: 'Ready to create work', badge: 'Ready', badgeClass: 'border-emerald-500/35 text-emerald-400' }
  return { headline: `${completed} of 4 essentials ready`, badge: 'Setup needed', badgeClass: 'border-amber-500/35 text-amber-400' }
}

function setupStatusPresentation(status: SetupStatus) {
  const milestones = setupMilestones(status, 'Desktop runtime')
  const completed = milestones.filter((milestone) => milestone.ready).length
  const readyAgents = status.agents.filter((agent) => agent.ready).map((agent) => agent.name)
  const missingTools = status.tools.filter((tool) => tool.required && !tool.ready).map((tool) => tool.name)
  const readiness = setupReadinessLabel(status.ready, completed)
  return {
    milestones,
    completed,
    ...readiness,
    details: [
      {
        label: 'Runtime',
        value: `${status.runtime.nodeVersion} · ${status.runtime.production ? 'production desktop build' : 'development build'}`,
      },
      { label: 'Source control', value: sourceControlStatus(status.scm) },
      { label: 'Ready agents', value: namesOrFallback(readyAgents, 'None yet') },
      { label: 'Missing required tools', value: namesOrFallback(missingTools, 'None') },
    ],
  }
}

function SetupStatusSummary({ status }: { status: SetupStatus }) {
  const presentation = setupStatusPresentation(status)

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm">{presentation.headline}</strong>
        <Badge variant="outline" className={presentation.badgeClass}>
          {presentation.badge}
        </Badge>
      </div>
      <Progress value={(presentation.completed / 4) * 100} className="h-1.5" />
      <div className="grid gap-2 sm:grid-cols-2">
        {presentation.milestones.map((milestone) => (
          <SetupMilestoneCard key={milestone.id} milestone={milestone} />
        ))}
      </div>
      <div className="grid gap-2 rounded-xl border border-border/55 bg-muted/15 p-4 text-xs text-muted-foreground">
        {presentation.details.map((detail) => (
          <span key={detail.label}>
            <strong className="text-foreground">{detail.label}:</strong> {detail.value}
          </span>
        ))}
      </div>
    </>
  )
}

function SetupCheckContent({
  status,
  loading,
  error,
  onRetry,
}: {
  status: SetupStatus | null
  loading: boolean
  error: string
  onRetry(): void
}) {
  if (!status && loading) {
    return (
      <div className="grid min-h-44 place-items-center text-sm text-muted-foreground">
        <span>
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          Inspecting this installation…
        </span>
      </div>
    )
  }
  return (
    <>
      {error && (
        <StatusPanel tone="danger">
          <CircleAlert />
          <StatusPanelContent>
            <StatusPanelTitle>Setup checks could not be loaded</StatusPanelTitle>
            <StatusPanelDescription>{error}</StatusPanelDescription>
          </StatusPanelContent>
          <StatusPanelActions>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw />
              Retry
            </Button>
          </StatusPanelActions>
        </StatusPanel>
      )}
      {status && <SetupStatusSummary status={status} />}
    </>
  )
}

function SetupNextSteps() {
  return (
    <div className="grid content-start gap-3">
      <GuideFeature icon={GitPullRequest} title="1. Connect source control">
        Authenticate the selected source-control extension. VertexADE uses it to discover repositories and load pull-request data.
      </GuideFeature>
      <GuideFeature icon={TerminalSquare} title="2. Prepare an execution agent">
        Install and sign in to at least one supported agent CLI. The detailed setup page shows the exact detected command and status.
      </GuideFeature>
      <GuideFeature icon={GitBranch} title="3. Add repositories">
        After this guide, open Settings → Workspace and register the local repositories where agents may create isolated worktrees.
      </GuideFeature>
      <p className="rounded-xl border border-border/55 bg-muted/15 p-4 text-xs leading-5 text-muted-foreground">
        You can enter the workspace even if a check is incomplete. The detailed setup page stays available for configuration and repair, and
        this guide can be reopened from Settings.
      </p>
    </div>
  )
}

function SetupGuide({ status, loading, error, onRetry }: { status: SetupStatus | null; loading: boolean; error: string; onRetry(): void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,.72fr)]">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Live desktop readiness</CardTitle>
              <CardDescription className="mt-1">These checks come from the bundled VertexADE service running on this Mac.</CardDescription>
            </div>
            <Button variant="outline" size="icon-sm" disabled={loading} aria-label="Run setup checks again" onClick={onRetry}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <SetupCheckContent status={status} loading={loading} error={error} onRetry={onRetry} />
        </CardContent>
      </Card>
      <SetupNextSteps />
    </div>
  )
}

function UnsupportedBrowserGuide() {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Open this guide in VertexADE Desktop</CardTitle>
          <CardDescription>
            The first-run guide stores completion in the installed desktop profile and is not available in a browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/setup">Open system setup</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

function useSetupChecks() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
  const [loadingSetup, setLoadingSetup] = useState(true)
  const [setupError, setSetupError] = useState('')
  const loadSetup = useCallback(async () => {
    setLoadingSetup(true)
    setSetupError('')
    try {
      setSetupStatus(parseSetupStatus(await api<unknown>('/api/setup/status')))
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingSetup(false)
    }
  }, [])

  useEffect(() => {
    void loadSetup()
  }, [loadSetup])

  return { setupStatus, loadingSetup, setupError, loadSetup }
}

function useDesktopOnboardingBridge(bridge: VertexADEDesktopBridge | null, onComplete: DesktopOnboardingProps['onComplete']) {
  const [desktopState, setDesktopState] = useState<DesktopOnboardingState | null>(null)
  const [completionError, setCompletionError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!bridge) return
    void bridge.onboarding
      .status()
      .then(setDesktopState)
      .catch(() => setDesktopState(null))
  }, [bridge])

  const finish = useCallback(
    async (destination: DesktopOnboardingDestination): Promise<void> => {
      if (!bridge) return
      setSaving(true)
      setCompletionError('')
      try {
        setDesktopState(await bridge.onboarding.complete())
        onComplete(destination)
      } catch (error) {
        setCompletionError(error instanceof Error ? error.message : String(error))
        setSaving(false)
      }
    },
    [bridge, onComplete],
  )

  return { desktopState, completionError, saving, finish }
}

function OnboardingSidebar({
  activeStep,
  desktopState,
  onShowStep,
}: {
  activeStep: number
  desktopState: DesktopOnboardingState | null
  onShowStep(index: number): void
}) {
  const progress = ((activeStep + 1) / desktopOnboardingSteps.length) * 100
  return (
    <aside className="border-b border-border/60 bg-card/50 p-4 backdrop-blur-xl lg:sticky lg:top-0 lg:h-svh lg:border-b-0 lg:border-r lg:p-6">
      <div className="flex items-center gap-3">
        <img src="/vertexade-mark.svg" alt="" className="size-9 rounded-xl" />
        <span>
          <strong className="block text-sm">VertexADE</strong>
          <span className="block text-xs text-muted-foreground">Desktop onboarding</span>
        </span>
      </div>
      <div className="mt-5 lg:mt-10">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
          <span>Guide progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="mt-2 h-1.5" />
      </div>
      <nav className="mt-4 lg:mt-7" aria-label="Onboarding steps">
        <ol className="grid grid-cols-5 gap-1 lg:grid-cols-1 lg:gap-1.5">
          {desktopOnboardingSteps.map((item, index) => {
            const Icon = item.icon
            const current = index === activeStep
            const visited = index < activeStep
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  aria-label={`${index + 1}. ${item.shortTitle}`}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-xs transition-colors lg:justify-start lg:px-3',
                    current && 'border-primary/20 bg-primary/[.09] text-foreground',
                    !current && 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                  onClick={() => onShowStep(index)}
                >
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-md bg-muted/50',
                      (current || visited) && 'bg-primary/12 text-primary',
                    )}
                  >
                    {visited ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                  </span>
                  <span className="hidden min-w-0 lg:block">
                    <span className="block truncate font-medium">{item.shortTitle}</span>
                    <span className="block text-[10px] text-muted-foreground">Step {index + 1}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="mt-6 hidden rounded-xl border border-border/50 bg-background/45 p-3 text-[11px] leading-5 text-muted-foreground lg:block">
        {desktopState?.completed
          ? 'You have completed this guide before. Finishing again keeps this desktop profile up to date.'
          : 'Completion is saved to this desktop profile, not to the temporary local web-server address.'}
      </div>
    </aside>
  )
}

function OnboardingStepContent({
  step,
  setupStatus,
  loadingSetup,
  setupError,
  onRetrySetup,
}: {
  step: OnboardingStep
  setupStatus: SetupStatus | null
  loadingSetup: boolean
  setupError: string
  onRetrySetup(): void
}) {
  if (step.id === 'welcome') return <WelcomeGuide />
  if (step.id === 'work') return <WorkGuide />
  if (step.id === 'threads') return <ThreadsGuide />
  if (step.id === 'pull-requests') return <PullRequestsGuide />
  return <SetupGuide status={setupStatus} loading={loadingSetup} error={setupError} onRetry={onRetrySetup} />
}

function OnboardingFooter({
  activeStep,
  saving,
  completionError,
  onShowStep,
  onFinish,
}: {
  activeStep: number
  saving: boolean
  completionError: string
  onShowStep(index: number): void
  onFinish(destination: DesktopOnboardingDestination): void
}) {
  const finalStep = activeStep === desktopOnboardingSteps.length - 1
  return (
    <footer className="mx-auto mt-7 flex w-full max-w-5xl flex-col gap-3 border-t border-border/55 pt-5 sm:flex-row sm:items-center">
      <Button variant="outline" disabled={activeStep === 0 || saving} onClick={() => onShowStep(activeStep - 1)}>
        <ArrowLeft />
        Back
      </Button>
      <span className="text-center text-xs text-muted-foreground sm:ml-2 sm:text-left">
        {activeStep + 1} of {desktopOnboardingSteps.length}
      </span>
      {completionError && <span className="text-xs text-destructive sm:ml-auto">{completionError}</span>}
      {finalStep ? (
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
          <Button variant="outline" disabled={saving} onClick={() => onFinish('setup')}>
            <Settings2 />
            Finish in detailed setup
          </Button>
          <Button disabled={saving} onClick={() => onFinish('workspace')}>
            {saving ? <Loader2 className="animate-spin" /> : <Rocket />}
            Open workspace
          </Button>
        </div>
      ) : (
        <Button className="sm:ml-auto" onClick={() => onShowStep(activeStep + 1)}>
          Continue
          <ArrowRight />
        </Button>
      )}
    </footer>
  )
}

export function DesktopOnboarding({ onComplete }: DesktopOnboardingProps) {
  const bridge = useMemo(() => desktopBridge(), [])
  const [activeStep, setActiveStep] = useState(0)
  const { setupStatus, loadingSetup, setupError, loadSetup } = useSetupChecks()
  const { desktopState, completionError, saving, finish } = useDesktopOnboardingBridge(bridge, onComplete)
  const step = desktopOnboardingSteps[activeStep]

  function showStep(index: number): void {
    setActiveStep(index)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!bridge) return <UnsupportedBrowserGuide />

  return (
    <main className="relative min-h-svh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_9%,transparent),transparent_32%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--primary)_6%,transparent),transparent_28%)]" />
      <div className="relative mx-auto grid min-h-svh max-w-[94rem] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <OnboardingSidebar activeStep={activeStep} desktopState={desktopState} onShowStep={showStep} />

        <section className="flex min-w-0 flex-col px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
          <header className="mx-auto w-full max-w-5xl">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-primary">{step.eyebrow}</p>
            <h1 className="mt-2 max-w-3xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{step.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{step.description}</p>
          </header>

          <div className="mx-auto mt-6 w-full max-w-5xl flex-1">
            <OnboardingStepContent
              step={step}
              setupStatus={setupStatus}
              loadingSetup={loadingSetup}
              setupError={setupError}
              onRetrySetup={() => void loadSetup()}
            />
          </div>

          <OnboardingFooter
            activeStep={activeStep}
            saving={saving}
            completionError={completionError}
            onShowStep={showStep}
            onFinish={(destination) => void finish(destination)}
          />
        </section>
      </div>
    </main>
  )
}
