import { Bot, ChevronDown, Clock3, FileText, GitBranch, Loader2, Plus, Settings2, Sparkles } from 'lucide-react'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { AgentResourcePicker, emptyAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { RepositoryMultiSelect } from '@vertexade/ui/components/repository-multi-select'
import { SequentialWorkOption } from '@vertexade/ui/components/sequential-work-option'
import { WorkReferencePicker } from '@vertexade/ui/components/work-reference-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import type { WorkBoardData, WorkItem } from '@vertexade/ui/lib/dashboard-types'

import { useNewWorkDialog } from './use-new-work-dialog'
export function NewWorkDialog({
  open,
  onOpenChange,
  data,
  onCreated,
  initialStartThread,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: WorkBoardData
  onCreated: () => void
  initialStartThread?: boolean
}) {
  // fallow-ignore-next-line code-duplication -- the hook's named return contract is intentionally destructured at its single consumer.
  const {
    title,
    setTitle,
    description,
    setDescription,
    kind,
    setKind,
    priority,
    setPriority,
    repositories,
    setRepositories,
    startThread,
    setStartThread,
    createPr,
    setCreatePr,
    splitWorkItem,
    setSplitWorkItem,
    references,
    setReferences,
    busy,
    generatingTitle,
    uploadingImages,
    setUploadingImages,
    resourceSelection,
    setResourceSelection,
    backends,
    backendId,
    setBackendId,
    generateTitle,
    submit,
  } = useNewWorkDialog({ open, onOpenChange, data, onCreated, initialStartThread })
  const targetRepositories = data.repositories.filter((repository) => !repository.backend_id || repository.backend_id === backendId)
  const selectedRepositoryNames = data.repositories
    .filter((repository) => repositories.includes(repository.id))
    .map((repository) => repository.full_name.split('/').at(-1) || repository.full_name)
  const launchSummary = startThread
    ? selectedRepositoryNames.length
      ? `Start now · ${selectedRepositoryNames.join(', ')}`
      : 'Choose a workspace to start'
    : 'Add to Work · start later'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>New work</DialogTitle>
            <DialogDescription>Describe the outcome, confirm its workspace, and go.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4">
            <section className="space-y-2" aria-labelledby="work-outcome">
              <div className="flex items-center justify-between gap-3">
                <Label id="work-outcome" htmlFor="work-title" className="text-sm font-semibold">
                  Outcome
                </Label>
                <span className="text-[11px] text-muted-foreground">Draft saved</span>
              </div>
              <Input
                id="work-title"
                autoFocus
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="text-base"
                placeholder="What should be different when this is done?"
              />
              <p className="text-xs text-muted-foreground">
                {repositories.length || !startThread
                  ? 'One sentence is enough. The rest is optional.'
                  : 'Add one sentence, then choose where the work should run.'}
              </p>
            </section>

            {backends.length > 1 && (
              <section className="space-y-2 rounded-lg border bg-muted/[.06] p-2.5" aria-label="Target server">
                <Label htmlFor="work-backend" className="text-xs font-semibold">
                  Server
                </Label>
                <Select value={backendId} onValueChange={setBackendId}>
                  <SelectTrigger id="work-backend" className="w-full">
                    <SelectValue placeholder="Choose a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {backends.map((backend) => (
                      <SelectItem key={backend.id} value={backend.id}>
                        {backend.label}
                        {backend.connected ? '' : ' · offline'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  The Work item, its threads, plugins, and future actions stay owned by this server.
                </p>
              </section>
            )}

            <section
              className="grid gap-2 rounded-lg border bg-muted/[.06] p-2.5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center"
              aria-labelledby="work-start-mode"
            >
              <div className="min-w-0">
                <Label id="work-start-mode" className="text-xs font-semibold">
                  Launch
                </Label>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {startThread ? 'Create the outcome and start its agent.' : 'Save the outcome without starting an agent.'}
                </p>
              </div>
              <SegmentedControl className="grid w-full grid-cols-2" aria-label="Work start mode">
                <SegmentedControlItem type="button" active={startThread} className="justify-center" onClick={() => setStartThread(true)}>
                  <Bot />
                  Start now
                </SegmentedControlItem>
                <SegmentedControlItem type="button" active={!startThread} className="justify-center" onClick={() => setStartThread(false)}>
                  <Clock3 />
                  Plan first
                </SegmentedControlItem>
              </SegmentedControl>
            </section>

            {startThread && (
              <section className="space-y-2" aria-label="Agent workspace">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                    <GitBranch className="size-3.5 text-blue-400" /> Workspace
                  </h3>
                  <span className="text-[11px] text-muted-foreground">Recent workspace suggested</span>
                </div>
                <RepositoryChooser repositories={targetRepositories} selected={repositories} onChange={setRepositories} />
              </section>
            )}

            <details className="group rounded-xl border bg-muted/[.08]">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50">
                  <FileText className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-xs">Context and screenshots</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {description.trim() ? 'Context added' : 'Optional · acceptance criteria, constraints, references'}
                  </small>
                </span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t p-3">
                <PromptImageTextarea
                  value={description}
                  onValueChange={setDescription}
                  onUploadingChange={setUploadingImages}
                  className="min-h-28"
                  placeholder="What good looks like, why it matters, constraints, or pasted screenshots…"
                />
                {description.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || generatingTitle || uploadingImages}
                    onClick={() => void generateTitle()}
                  >
                    {generatingTitle ? <Loader2 className="animate-spin" /> : <Sparkles />}Suggest a concise outcome
                  </Button>
                )}
              </div>
            </details>

            <details className="group rounded-xl border bg-muted/[.08]">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50">
                  <Settings2 className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-xs">More options</strong>
                  <small className="block text-[11px] text-muted-foreground">Agent, delivery, type, priority, and references</small>
                </span>
                <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t p-3">
                {startThread && (
                  <section className="space-y-4 rounded-lg border bg-background/50 p-3" aria-label="Agent and delivery setup">
                    <AgentOptionsPicker backendId={backendId} />
                    <AgentResourcePicker
                      backendId={backendId}
                      value={resourceSelection || emptyAgentResourceSelection}
                      onChange={setResourceSelection}
                    />
                    <Label className="flex items-start gap-3 rounded-lg border p-3">
                      <Checkbox className="mt-0.5" checked={createPr} onCheckedChange={(value) => setCreatePr(Boolean(value))} />
                      <span>
                        <strong className="block text-xs">Create draft pull requests</strong>
                        <small className="text-[11px] text-muted-foreground">Link each repository’s delivery back to this Work item.</small>
                      </span>
                    </Label>
                  </section>
                )}
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <Label className="flex-col items-stretch gap-1.5">
                    Type
                    <Select value={kind} onValueChange={(value) => setKind(value as WorkItem['kind'])}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="implementation">Implementation</SelectItem>
                        <SelectItem value="investigation">Investigation</SelectItem>
                        <SelectItem value="operational">Operational</SelectItem>
                      </SelectContent>
                    </Select>
                  </Label>
                  <Label className="flex-col items-stretch gap-1.5">
                    Priority
                    <Select value={priority} onValueChange={(value) => setPriority(value as WorkItem['priority'])}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Label>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-medium">Source context</h3>
                  <WorkReferencePicker backendId={backendId} selected={references} onChange={setReferences} />
                </div>
                <SequentialWorkOption checked={splitWorkItem} onCheckedChange={setSplitWorkItem} />
              </div>
            </details>
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{launchSummary}</span>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button type="button" variant="outline" className="hidden sm:inline-flex" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  generatingTitle ||
                  uploadingImages ||
                  (!title.trim() && !description.trim()) ||
                  (startThread && !repositories.length)
                }
              >
                {busy || uploadingImages ? <Loader2 className="animate-spin" /> : startThread ? <Bot /> : <Plus />}
                {uploadingImages
                  ? 'Adding images…'
                  : busy && !title.trim()
                    ? 'Creating outcome…'
                    : startThread
                      ? `Start work${repositories.length > 1 ? ` in ${repositories.length} repositories` : ''}`
                      : 'Create work'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RepositoryChooser({
  repositories,
  selected,
  onChange,
}: {
  repositories: WorkBoardData['repositories']
  selected: number[]
  onChange(ids: number[]): void
}) {
  const names = repositories.filter((repository) => selected.includes(repository.id)).map((repository) => repository.full_name)
  return (
    <div className="space-y-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start">
            <GitBranch />
            <span className="min-w-0 flex-1 truncate text-left">{names.length ? names.join(', ') : 'Choose repositories'}</span>
            {selected.length > 0 && (
              <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[11px] text-blue-300">{selected.length}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))]">
          <RepositoryMultiSelect repositories={repositories} selected={selected} onChange={onChange} />
        </PopoverContent>
      </Popover>
      {!selected.length && <p className="text-[11px] text-amber-300">Select at least one repository to start an agent.</p>}
    </div>
  )
}
