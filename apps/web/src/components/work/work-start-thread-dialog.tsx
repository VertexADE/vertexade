import { Bot, ChevronDown, FileSearch, Loader2, Settings2 } from 'lucide-react'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { AgentResourcePicker, emptyAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { RepositoryMultiSelect } from '@vertexade/ui/components/repository-multi-select'
import { SequentialWorkOption } from '@vertexade/ui/components/sequential-work-option'
import { WorkReferencePicker } from '@vertexade/ui/components/work-reference-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Label } from '@vertexade/ui/components/ui/label'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { useStartThreadDialog } from './use-start-thread-dialog'

export function StartThreadDialog({
  item,
  open,
  onOpenChange,
  onStarted,
}: {
  item: WorkItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: () => void
}) {
  const {
    prompt,
    setPrompt,
    createPr,
    setCreatePr,
    splitWorkItem,
    setSplitWorkItem,
    repositories,
    selected,
    setSelected,
    references,
    setReferences,
    busy,
    uploadingImages,
    setUploadingImages,
    resourceSelection,
    setResourceSelection,
    contributorReview,
    submit,
  } = useStartThreadDialog({ item, open, onOpenChange, onStarted })
  const retrying = Boolean(item.attention)
  const copy = startThreadCopy(item.key, contributorReview, retrying)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="mx-0 mt-0">
          <DialogTitle className="flex items-center gap-2">
            <copy.icon className={copy.iconClassName} />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:space-y-4 sm:p-4">
          <ImplementationStartFields
            hidden={contributorReview}
            prompt={prompt}
            onPromptChange={setPrompt}
            onUploadingChange={setUploadingImages}
            references={references}
            onReferencesChange={setReferences}
            repositories={repositories}
            selected={selected}
            onSelectedChange={setSelected}
          />
          <AgentSettings workItemId={item.id} resourceSelection={resourceSelection} onResourceSelectionChange={setResourceSelection} />
          <ImplementationDeliveryOptions
            hidden={contributorReview}
            splitWorkItem={splitWorkItem}
            onSplitWorkItemChange={setSplitWorkItem}
            createPr={createPr}
            onCreatePrChange={setCreatePr}
          />
        </div>
        <StartThreadFooter
          contributorReview={contributorReview}
          retrying={retrying}
          busy={busy}
          uploadingImages={uploadingImages}
          prompt={prompt}
          selectedCount={selected.length}
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  )
}

function startThreadCopy(workKey: string, contributorReview: boolean, retrying: boolean) {
  const verb = retrying ? 'Retry' : 'Start'
  if (contributorReview)
    return {
      icon: FileSearch,
      iconClassName: 'size-5 text-cyan-400',
      title: `${verb} agent review`,
      description: `${workKey} · review the latest linked pull-request revision with the saved defaults.`,
    }
  return {
    icon: Bot,
    iconClassName: 'size-5 text-blue-400',
    title: `${verb} agent work`,
    description: `${workKey} · continue this outcome with one independent thread per repository.`,
  }
}

function ImplementationStartFields({
  hidden,
  prompt,
  onPromptChange,
  onUploadingChange,
  references,
  onReferencesChange,
  repositories,
  selected,
  onSelectedChange,
}: {
  hidden: boolean
  prompt: string
  onPromptChange: (value: string) => void
  onUploadingChange: (uploading: boolean) => void
  references: Parameters<typeof WorkReferencePicker>[0]['selected']
  onReferencesChange: Parameters<typeof WorkReferencePicker>[0]['onChange']
  repositories: Parameters<typeof RepositoryMultiSelect>[0]['repositories']
  selected: number[]
  onSelectedChange: (value: number[]) => void
}) {
  if (hidden) return null
  return (
    <>
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/[.05] p-3 text-[11px] leading-relaxed text-muted-foreground">
        <Bot className="mr-2 inline size-4 text-blue-400" />
        <strong className="text-blue-300">Work thread:</strong> use this for implementation or investigation. To inspect a stopped worktree
        without changing it, start a review thread instead.
      </div>
      <PromptImageTextarea
        value={prompt}
        onValueChange={onPromptChange}
        onUploadingChange={onUploadingChange}
        className="min-h-32"
        placeholder="Describe the complete outcome and paste reference images…"
      />
      <WorkReferencePicker selected={references} onChange={onReferencesChange} />
      <RepositoryMultiSelect repositories={repositories} selected={selected} onChange={onSelectedChange} />
    </>
  )
}

function AgentSettings({
  workItemId,
  resourceSelection,
  onResourceSelectionChange,
}: {
  workItemId: number
  resourceSelection: Parameters<typeof AgentResourcePicker>[0]['value'] | null
  onResourceSelectionChange: Parameters<typeof AgentResourcePicker>[0]['onChange']
}) {
  return (
    <details className="group rounded-lg border bg-muted/[.08]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium">
        <Settings2 className="size-3.5 text-muted-foreground" />
        <span className="flex-1">Agent and context settings</span>
        <span className="text-[11px] font-normal text-muted-foreground">Use saved defaults</span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t p-3">
        <AgentOptionsPicker />
        <AgentResourcePicker
          workItemId={workItemId}
          value={resourceSelection ?? emptyAgentResourceSelection}
          onChange={onResourceSelectionChange}
        />
      </div>
    </details>
  )
}

function ImplementationDeliveryOptions({
  hidden,
  splitWorkItem,
  onSplitWorkItemChange,
  createPr,
  onCreatePrChange,
}: {
  hidden: boolean
  splitWorkItem: boolean
  onSplitWorkItemChange: (value: boolean) => void
  createPr: boolean
  onCreatePrChange: (value: boolean) => void
}) {
  if (hidden) return null
  return (
    <>
      <SequentialWorkOption checked={splitWorkItem} onCheckedChange={onSplitWorkItemChange} />
      <Label className="flex items-start gap-2 rounded-lg border p-3">
        <Checkbox checked={createPr} onCheckedChange={(value) => onCreatePrChange(Boolean(value))} />
        <span>
          <strong className="block text-xs">Create a draft PR in every repository</strong>
          <small className="text-[11px] text-muted-foreground">Each independent PR becomes a delivery link on this Work item.</small>
        </span>
      </Label>
    </>
  )
}

function startThreadAction(contributorReview: boolean, retrying: boolean, busy: boolean, uploadingImages: boolean, selectedCount: number) {
  const verb = ['Start', 'Retry'][Number(retrying)]
  const suffix = ['s', ''][Number(selectedCount === 1)]
  const workLabel = `${verb} ${selectedCount} agent thread${suffix}`
  return [
    uploadingImages ? { icon: Loader2, iconClassName: 'animate-spin', label: 'Embedding images…' } : null,
    busy ? { icon: Loader2, iconClassName: 'animate-spin', label: 'Starting…' } : null,
    contributorReview ? { icon: FileSearch, iconClassName: '', label: `${verb} review` } : null,
    { icon: Bot, iconClassName: '', label: workLabel },
  ].find(Boolean)!
}

function StartThreadFooter({
  contributorReview,
  retrying,
  busy,
  uploadingImages,
  prompt,
  selectedCount,
  onCancel,
  onSubmit,
}: {
  contributorReview: boolean
  retrying: boolean
  busy: boolean
  uploadingImages: boolean
  prompt: string
  selectedCount: number
  onCancel: () => void
  onSubmit: () => void
}) {
  const implementationReady = Boolean(prompt.trim() && selectedCount)
  const disabled = [busy, uploadingImages, contributorReview ? false : !implementationReady].some(Boolean)
  const action = startThreadAction(contributorReview, retrying, busy, uploadingImages, selectedCount)
  const ActionIcon = action.icon
  return (
    <DialogFooter className="mx-0 mb-0 rounded-none px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:mb-0 sm:px-4">
      <Button className="h-11 sm:h-8" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button className="h-11 sm:h-8" disabled={disabled} onClick={onSubmit}>
        <ActionIcon className={action.iconClassName} />
        {action.label}
      </Button>
    </DialogFooter>
  )
}
