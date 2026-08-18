import {
  Bot,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  GitBranch,
  HardDrive,
  Layers3,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { AgentResourcePicker, emptyAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { RepositoryMultiSelect } from '@vertexade/ui/components/repository-multi-select'
import { RepositorySearchPicker } from '@vertexade/ui/components/repository-search-picker'
import { SequentialWorkOption } from '@vertexade/ui/components/sequential-work-option'
import { WorkReferencePicker } from '@vertexade/ui/components/work-reference-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { Label } from '@vertexade/ui/components/ui/label'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@vertexade/ui/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import type { WorkBoardData, WorkItem } from '@vertexade/ui/lib/dashboard-types'

import { useNewWorkDialog } from './use-new-work-dialog'
import { ServerDirectoryBrowserDialog } from '../settings/server-directory-browser-dialog'
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
  const [step, setStep] = useState(0)
  const [quick, setQuick] = useState(true)
  useEffect(() => {
    if (open) {
      setStep(0)
      setQuick(true)
    }
  }, [open])
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
    unifiedRepositories,
    capableBackends,
    discoveringCapabilities,
    targetBackendIds,
    primaryBackendId,
    toggleTargetBackend,
    generateTitle,
    addRepository,
    addLocalFolder,
    submit,
  } = useNewWorkDialog({ open, onOpenChange, data, onCreated, initialStartThread })
  const targetRepositories = unifiedRepositories
  const selectedRepositoryNames = unifiedRepositories
    .filter((repository) => repositories.includes(repository.id))
    .map((repository) => repository.full_name.split('/').at(-1) || repository.full_name)
  const selectedRepositories = targetRepositories.filter((repository) => repositories.includes(repository.id))
  const supportsPullRequests =
    selectedRepositories.length > 0 &&
    selectedRepositories.every((repository) => repository.source_kind !== 'directory' && repository.source_kind !== 'workspace')
  const launchSummary = startThread
    ? selectedRepositoryNames.length
      ? `Start now · ${selectedRepositoryNames.join(', ')} · ${targetBackendIds.length} ${targetBackendIds.length === 1 ? 'server' : 'servers'}`
      : `Start in a managed general workspace · ${targetBackendIds.length} ${targetBackendIds.length === 1 ? 'server' : 'servers'}`
    : `Add to Work on ${targetBackendIds.length} ${targetBackendIds.length === 1 ? 'server' : 'servers'} · start later`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0 sm:max-w-[42rem]">
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Create Work</DialogTitle>
            <DialogDescription>Describe the outcome, choose a workspace, and start.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <FieldGroup>
              <nav className={quick ? 'hidden' : 'grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1'} aria-label="Create Work progress">
                {['Intent', 'Context', 'Agent'].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    className={
                      index === step
                        ? 'rounded-md bg-background px-2 py-1.5 text-xs font-medium shadow-sm'
                        : 'px-2 py-1.5 text-xs text-muted-foreground'
                    }
                    onClick={() => index < step && setStep(index)}
                  >
                    {index + 1}. {label}
                  </button>
                ))}
              </nav>
              <Button
                type="button"
                variant={quick ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  const next = !quick
                  setQuick(next)
                  if (next) setStartThread(true)
                }}
              >
                {quick ? 'Use guided steps' : 'Quick start'}
              </Button>
              <Field aria-labelledby="work-outcome" className={step === 0 || quick ? '' : 'hidden'}>
                <Label id="work-outcome" htmlFor="work-title" className="text-sm font-semibold">
                  What should be different when this is done?
                </Label>
                <Textarea
                  id="work-title"
                  autoFocus
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="min-h-32 resize-none text-base leading-relaxed"
                  placeholder="Describe the intended outcome and what should be different when the work is complete…"
                />
                <FieldDescription>One sentence is enough. The rest is optional.</FieldDescription>
              </Field>

              {quick && startThread && (
                <section className="rounded-lg border bg-muted/[.06] p-2.5" aria-label="Quick agent setup">
                  <AgentOptionsPicker backendId={primaryBackendId} fields="essentials" />
                </section>
              )}

              <div className={step === 1 || quick ? 'contents' : 'hidden'}>
                <Field aria-label="Work scope">
                  <RepositoryChooser
                    repositories={targetRepositories}
                    selected={repositories}
                    backendId={primaryBackendId}
                    onChange={(ids) => setRepositories(quick ? ids.slice(-1) : ids)}
                    onAdd={async (repository) => {
                      const id = await addRepository(repository)
                      if (quick) setRepositories([id])
                    }}
                    onAddLocal={async (input) => {
                      const id = await addLocalFolder(input)
                      if (quick) setRepositories([id])
                    }}
                    backendName={backends.find((backend) => backend.id === primaryBackendId)?.label || 'server'}
                  />
                  <WorkTargetServers
                    backends={capableBackends}
                    discovering={discoveringCapabilities}
                    selected={targetBackendIds}
                    onChange={toggleTargetBackend}
                  />
                </Field>

                <details open className={quick ? 'hidden' : 'group rounded-xl border bg-muted/[.08]'}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-xs">Supporting context</strong>
                      <small className="text-[11px] text-muted-foreground">
                        Constraints, acceptance criteria, references, and screenshots
                      </small>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t p-3">
                    <PromptImageTextarea
                      value={description}
                      onValueChange={setDescription}
                      onUploadingChange={setUploadingImages}
                      className="min-h-28"
                      placeholder="What good looks like, constraints, or pasted screenshots…"
                    />
                  </div>
                </details>
              </div>

              <div className={step === 2 || quick ? 'contents' : 'hidden'}>
                <section
                  className={
                    quick
                      ? 'hidden'
                      : 'grid gap-2 rounded-lg border bg-muted/[.06] p-2.5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center'
                  }
                  aria-labelledby="work-start-mode"
                >
                  <div className="min-w-0">
                    <Label id="work-start-mode" className="text-xs font-semibold">
                      Choose when to start
                    </Label>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {startThread ? 'Create the outcome and start its agent.' : 'Save the outcome without starting an agent.'}
                    </p>
                  </div>
                  <SegmentedControl className="grid w-full grid-cols-2" aria-label="Work start mode">
                    <SegmentedControlItem
                      type="button"
                      active={startThread}
                      className="justify-center"
                      onClick={() => setStartThread(true)}
                    >
                      <Bot />
                      Start now
                    </SegmentedControlItem>
                    <SegmentedControlItem
                      type="button"
                      active={!startThread}
                      className="justify-center"
                      onClick={() => setStartThread(false)}
                    >
                      <Clock3 />
                      Plan first
                    </SegmentedControlItem>
                  </SegmentedControl>
                </section>

                <details className="hidden">
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

                <details open className={quick ? 'hidden' : 'group rounded-xl border bg-muted/[.08]'}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50">
                      <Settings2 className="size-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-xs">Agent configuration</strong>
                      <small className="block text-[11px] text-muted-foreground">Model, reasoning, extensions, and delivery</small>
                    </span>
                    <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t p-3">
                    {startThread && (
                      <section className="space-y-4 rounded-lg border bg-background/50 p-3" aria-label="Agent and delivery setup">
                        <AgentOptionsPicker backendId={primaryBackendId} />
                        <AgentResourcePicker
                          backendId={primaryBackendId}
                          value={resourceSelection || emptyAgentResourceSelection}
                          onChange={setResourceSelection}
                        />
                        <Label
                          data-disabled={!supportsPullRequests || undefined}
                          className="flex items-start gap-3 rounded-lg border p-3 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={supportsPullRequests && createPr}
                            disabled={!supportsPullRequests}
                            onCheckedChange={(value) => setCreatePr(Boolean(value))}
                          />
                          <span>
                            <strong className="block text-xs">Create draft pull requests</strong>
                            <small className="text-[11px] text-muted-foreground">
                              {supportsPullRequests
                                ? 'Link each Git repository’s delivery back to this Work item.'
                                : 'Available when every selected source is a Git repository.'}
                            </small>
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
                            <SelectGroup>
                              <SelectItem value="implementation">Implementation</SelectItem>
                              <SelectItem value="investigation">Investigation</SelectItem>
                              <SelectItem value="operational">Operational</SelectItem>
                            </SelectGroup>
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
                            <SelectGroup>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Label>
                    </div>
                    <div>
                      <h3 className="mb-2 text-xs font-medium">Source context</h3>
                      <WorkReferencePicker backendId={primaryBackendId} selected={references} onChange={setReferences} />
                    </div>
                    <SequentialWorkOption checked={splitWorkItem} onCheckedChange={setSplitWorkItem} />
                  </div>
                </details>
              </div>
            </FieldGroup>
          </div>
          <DialogFooter className="border-t bg-muted/[.04] px-5 py-3 sm:items-center sm:justify-between">
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{launchSummary}</span>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button type="button" variant="outline" className="hidden sm:inline-flex" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {!quick && step > 0 && (
                <Button type="button" variant="outline" onClick={() => setStep((value) => value - 1)}>
                  Back
                </Button>
              )}
              {!quick && step < 2 ? (
                <Button type="button" disabled={step === 0 && !title.trim()} onClick={() => setStep((value) => value + 1)}>
                  Continue
                </Button>
              ) : (
                <Button
                  disabled={
                    busy || generatingTitle || uploadingImages || !targetBackendIds.length || (!title.trim() && !description.trim())
                  }
                >
                  {busy || uploadingImages ? <Loader2 className="animate-spin" /> : startThread ? <Bot /> : <Plus />}
                  {uploadingImages
                    ? 'Adding images…'
                    : busy && !title.trim()
                      ? 'Creating outcome…'
                      : startThread
                        ? `Start work${targetBackendIds.length > 1 ? ` on ${targetBackendIds.length} servers` : ''}`
                        : `Create work${targetBackendIds.length > 1 ? ` on ${targetBackendIds.length} servers` : ''}`}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WorkTargetServers({
  backends,
  discovering,
  selected,
  onChange,
}: {
  backends: Array<{ id: string; label: string }>
  discovering: boolean
  selected: string[]
  onChange(backendId: string, selected: boolean): void
}) {
  if (backends.length <= 1 && !discovering) return null
  return (
    <FieldSet className="rounded-xl border border-primary/25 bg-primary/[.04] p-3">
      <FieldLegend variant="label">Run on</FieldLegend>
      <FieldDescription>
        Every selected server can access all chosen projects. Select several to initialize the Work item on each.
      </FieldDescription>
      {discovering && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="animate-spin" /> Checking authenticated servers…
        </p>
      )}
      <FieldGroup className="gap-2">
        {backends.map((backend) => {
          const checked = selected.includes(backend.id)
          const id = `work-target-${backend.id}`
          return (
            <Field key={backend.id} orientation="horizontal">
              <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(backend.id, Boolean(value))} />
              <FieldLabel htmlFor={id} className="font-normal">
                {backend.label}
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>
    </FieldSet>
  )
}

function RepositoryChooser({
  repositories,
  selected,
  backendId,
  onChange,
  onAdd,
  onAddLocal,
  backendName,
}: {
  repositories: WorkBoardData['repositories']
  selected: number[]
  backendId: string
  onChange(ids: number[]): void
  onAdd(repository: string): Promise<void>
  onAddLocal(input: { local_path: string; name?: string; workspace_strategy: 'direct' | 'copy' }): Promise<void>
  backendName: string
}) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const [localPath, setLocalPath] = useState('')
  const [localName, setLocalName] = useState('')
  const [localStrategy, setLocalStrategy] = useState<'direct' | 'copy'>('direct')
  const [addingLocal, setAddingLocal] = useState(false)
  const [sourceMode, setSourceMode] = useState<'general' | 'projects'>(() => (selected.length ? 'projects' : 'general'))
  const selectedRepositories = repositories.filter((repository) => selected.includes(repository.id))
  const names = selectedRepositories.map((repository) => repository.full_name)
  const generalWorkspace = sourceMode === 'general'
  useEffect(() => {
    if (selected.length) setSourceMode('projects')
  }, [selected.length])
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl className="grid w-full grid-cols-2" aria-label="Workspace source">
        <SegmentedControlItem
          type="button"
          active={generalWorkspace}
          className="justify-center"
          onClick={() => {
            setSourceMode('general')
            onChange([])
          }}
        >
          <Layers3 />
          General workspace
        </SegmentedControlItem>
        <SegmentedControlItem
          type="button"
          active={!generalWorkspace}
          className="justify-center"
          onClick={() => {
            setSourceMode('projects')
            if (!selected.length && repositories[0]) onChange([repositories[0].id])
          }}
        >
          <FolderOpen />
          Project sources
        </SegmentedControlItem>
      </SegmentedControl>
      {generalWorkspace ? (
        <FieldDescription>Use an empty managed folder for research, writing, planning, or other project-independent work.</FieldDescription>
      ) : (
        <>
          <RepositorySearchPicker
            backendId={backendId}
            added={repositories.map((repository) => repository.full_name)}
            onSelect={(repository) => onAdd(repository.id)}
          />
          <div className="grid gap-2 rounded-lg border bg-muted/[.05] p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="Local folder path"
                className="min-w-0 font-mono text-xs"
                placeholder="/path/on/server"
                value={localPath}
                onChange={(event) => setLocalPath(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => setBrowserOpen(true)}>
                <FolderOpen /> Browse
              </Button>
            </div>
            <Input
              aria-label="Local folder name"
              placeholder="Name (optional)"
              value={localName}
              onChange={(event) => setLocalName(event.target.value)}
            />
            <div className="flex gap-2">
              <Select value={localStrategy} onValueChange={(value) => setLocalStrategy(value as typeof localStrategy)}>
                <SelectTrigger aria-label="Local folder behavior">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="direct">Direct · live</SelectItem>
                    <SelectItem value="copy">Copy · merge back</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                disabled={!localPath.trim() || addingLocal}
                onClick={() =>
                  void (async () => {
                    setAddingLocal(true)
                    try {
                      await onAddLocal({
                        local_path: localPath.trim(),
                        ...(localName.trim() ? { name: localName.trim() } : {}),
                        workspace_strategy: localStrategy,
                      })
                      setLocalPath('')
                      setLocalName('')
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'Local folder could not be added')
                    } finally {
                      setAddingLocal(false)
                    }
                  })()
                }
              >
                {addingLocal ? <Loader2 className="animate-spin" /> : <Plus />} Add
              </Button>
            </div>
            <FieldDescription className="sm:col-span-full">{localWorkspaceStrategyDescription(localStrategy)}</FieldDescription>
          </div>
          <ServerDirectoryBrowserDialog
            open={browserOpen}
            backendId={backendId}
            backendName={backendName}
            initialPath={localPath}
            onOpenChange={setBrowserOpen}
            onSelect={setLocalPath}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-start">
                <HardDrive />
                <span className="min-w-0 flex-1 truncate text-left">{names.length ? names.join(', ') : 'Choose repositories'}</span>
                <Badge variant="secondary">{selected.length}</Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))]">
              <RepositoryMultiSelect
                repositories={repositories}
                selected={selected}
                onChange={onChange}
                emptySelectionLabel="general workspace"
              />
            </PopoverContent>
          </Popover>
          <div className="flex flex-wrap gap-1.5" aria-label="Selected workspace behavior">
            {selectedRepositories.map((repository) => (
              <Badge key={repository.id} variant="outline">
                {repository.source_kind === 'directory' ? <FolderOpen data-icon="inline-start" /> : <GitBranch data-icon="inline-start" />}
                {repository.full_name.split('/').at(-1) || repository.full_name}
                {' · '}
                {workspaceBehavior(repository.source_kind, repository.workspace_strategy)}
              </Badge>
            ))}
          </div>
          <FieldDescription>
            Git projects use isolated worktrees by default. Local directories follow the direct, copy, or move-on-apply behavior configured
            in Settings.
          </FieldDescription>
        </>
      )}
    </div>
  )
}

function workspaceBehavior(
  sourceKind: WorkBoardData['repositories'][number]['source_kind'],
  strategy: WorkBoardData['repositories'][number]['workspace_strategy'],
) {
  if (sourceKind === 'directory') {
    if (strategy === 'move') return 'isolated · replace on apply'
    if (strategy === 'copy') return 'isolated · merge on apply'
    return 'direct · live edits'
  }
  return strategy === 'direct' ? 'direct' : 'worktree'
}

function localWorkspaceStrategyDescription(strategy: 'direct' | 'copy') {
  if (strategy === 'direct') return 'The Work folder links to the original directory. Agent edits are immediately visible there.'
  return 'Work happens in an isolated copy. Apply previews and pastes approved changed and deleted files back after a conflict check.'
}
