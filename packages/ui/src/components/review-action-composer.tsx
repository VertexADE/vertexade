import { useState, type Dispatch, type SetStateAction } from 'react'
import { CheckCircle2, Loader2, MessageSquareText, ShieldAlert, type LucideIcon } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { ContextualActionField } from '@vertexade/ui/components/contextual-action-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@vertexade/ui/components/ui/radio-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@vertexade/ui/components/ui/sheet'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import {
  contextualConfirmationValue,
  type ContextualActionEntity,
  type ResolvedContextualAction,
} from '@vertexade/ui/lib/contextual-actions'
import { reviewActionReady, selectedReviewAction } from '@vertexade/ui/lib/review-action-composer'
import { cn } from '@vertexade/ui/lib/utils'

type ReviewActionRunner = {
  busy: string | null
  confirmation: string
  fieldValues: Record<string, string>
  sheetOpen: boolean
  execute(action: ResolvedContextualAction): Promise<void>
  setConfirmation(value: string): void
  setFieldValues: Dispatch<SetStateAction<Record<string, string>>>
  setSheetOpen(open: boolean): void
}

export function ReviewActionComposer({
  actions,
  entity,
  runner,
}: {
  actions: ResolvedContextualAction[]
  entity: ContextualActionEntity
  runner: ReviewActionRunner
}) {
  const mobile = useIsMobile()
  const [selectedId, setSelectedId] = useState('')
  const selected = selectedReviewAction(actions, selectedId)
  const setOpen = (open: boolean) => {
    if (!runner.busy) runner.setSheetOpen(open)
  }
  const select = (id: string) => {
    const fieldNames = new Set(actions.find((action) => action.id === id)?.inputFields?.map((field) => field.name) || [])
    setSelectedId(id)
    runner.setConfirmation('')
    runner.setFieldValues((current) => Object.fromEntries(Object.entries(current).filter(([name]) => fieldNames.has(name))))
  }
  const trigger = (
    <Button variant="outline" size="sm" data-audit-action="pull-request.review.open">
      <MessageSquareText />
      Submit review
    </Button>
  )
  const content = selected ? (
    <ReviewComposerContent actions={actions} entity={entity} selected={selected} runner={runner} select={select} />
  ) : null
  const footer = selected ? <ReviewComposerFooter entity={entity} selected={selected} runner={runner} /> : null

  if (!mobile)
    return (
      <Dialog open={runner.sheetOpen} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="sm:max-w-xl" showCloseButton={!runner.busy}>
          <ReviewComposerHeader entity={entity} />
          {content}
          <DialogFooter className="justify-between">{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    )

  return (
    <Sheet open={runner.sheetOpen} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0" showCloseButton={!runner.busy}>
        <ReviewComposerHeader entity={entity} mobile />
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{content}</div>
        <SheetFooter className="justify-between pb-[max(.75rem,env(safe-area-inset-bottom))]">{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ReviewComposerHeader({ entity, mobile = false }: { entity: ContextualActionEntity; mobile?: boolean }) {
  const description = (
    <>
      Choose a decision and add context. This applies to commit <CommitReference entity={entity} />.
    </>
  )
  if (mobile)
    return (
      <SheetHeader className="text-left">
        <SheetTitle>Submit your review</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
    )
  return (
    <DialogHeader>
      <DialogTitle>Submit your review</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  )
}

function ReviewComposerContent({
  actions,
  entity,
  selected,
  runner,
  select,
}: {
  actions: ResolvedContextualAction[]
  entity: ContextualActionEntity
  selected: ResolvedContextualAction
  runner: ReviewActionRunner
  select(id: string): void
}) {
  return (
    <div className="space-y-3" data-audit-action="pull-request.review.composer">
      <ReviewDecisionPicker actions={actions} selectedId={selected.id} busy={Boolean(runner.busy)} select={select} />
      <div className="rounded-lg border border-border/75 bg-background/35 p-3">
        {(selected.inputFields || []).map((field) => (
          <ContextualActionField
            key={field.name}
            field={field}
            value={runner.fieldValues[field.name] ?? ''}
            disabled={Boolean(runner.busy)}
            requirementHint
            textareaClassName="min-h-24 resize-y sm:min-h-28"
            onChange={(value) => runner.setFieldValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
        {!selected.inputFields?.length && <p className="text-xs text-muted-foreground">No comment is needed for this decision.</p>}
        <TypedConfirmation action={selected} entity={entity} runner={runner} />
      </div>
    </div>
  )
}

function ReviewDecisionPicker({
  actions,
  selectedId,
  busy,
  select,
}: {
  actions: ResolvedContextualAction[]
  selectedId: string
  busy: boolean
  select(id: string): void
}) {
  return (
    <RadioGroup value={selectedId} onValueChange={select} className="gap-1.5" aria-label="Review decision">
      {actions.map((action) => (
        <ReviewDecisionOption key={`${action.moduleId}:${action.id}`} action={action} selected={selectedId === action.id} busy={busy} />
      ))}
    </RadioGroup>
  )
}

function ReviewDecisionOption({ action, selected, busy }: { action: ResolvedContextualAction; selected: boolean; busy: boolean }) {
  const state = reviewDecisionState(action, selected, busy)
  const descriptionId = `${action.id}-review-description`
  return (
    <Label htmlFor={action.id} className={state.className}>
      <RadioGroupItem
        id={action.id}
        value={action.id}
        disabled={state.disabled}
        aria-describedby={descriptionId}
        data-audit-action={`pull-request.review.decision.${action.id}`}
        className="size-4 min-h-4 min-w-4"
      />
      <state.Icon className={cn('size-4 shrink-0', state.iconClassName)} />
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-medium text-foreground">{action.label}</strong>
        <small id={descriptionId} className="block text-xs leading-snug text-muted-foreground">
          {state.description}
        </small>
      </span>
    </Label>
  )
}

function TypedConfirmation({
  action,
  entity,
  runner,
}: {
  action: ResolvedContextualAction
  entity: ContextualActionEntity
  runner: ReviewActionRunner
}) {
  if (action.confirmation?.level !== 'typed') return null
  const value = contextualConfirmationValue(action, entity)
  return (
    <Label className="mt-3 flex-col items-stretch gap-1.5">
      <span>
        Type <strong className="font-mono text-foreground">{value}</strong> to confirm
      </span>
      <Input value={runner.confirmation} disabled={Boolean(runner.busy)} onChange={(event) => runner.setConfirmation(event.target.value)} />
    </Label>
  )
}

function ReviewComposerFooter({
  entity,
  selected,
  runner,
}: {
  entity: ContextualActionEntity
  selected: ResolvedContextualAction
  runner: ReviewActionRunner
}) {
  const state = reviewSubmitState(selected, entity, runner)
  return (
    <>
      <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => runner.setSheetOpen(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant={state.variant}
        disabled={state.disabled}
        onClick={() => void runner.execute(selected)}
        data-audit-action="pull-request.review.submit"
      >
        <state.Icon className={state.busy ? 'animate-spin' : undefined} />
        {state.label}
      </Button>
    </>
  )
}

function reviewDecisionState(action: ResolvedContextualAction, selected: boolean, busy: boolean) {
  const disabled = !action.enabled || busy
  return {
    Icon: reviewActionIcon(action),
    className: cn(
      'flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
      selected ? reviewActionSelectedClass(action) : 'border-border/70 bg-background/25 hover:bg-muted/45',
      disabled && 'cursor-not-allowed opacity-55',
    ),
    description: action.disabledReason || action.description || `Run through ${action.moduleName}`,
    disabled,
    iconClassName: reviewActionIconClass(action),
  }
}

function reviewSubmitState(action: ResolvedContextualAction, entity: ContextualActionEntity, runner: ReviewActionRunner) {
  const busy = Boolean(runner.busy)
  return {
    busy,
    disabled: busy ? true : !reviewActionReady(action, entity, runner.fieldValues, runner.confirmation),
    Icon: reviewSubmitIcon(action, busy),
    label: reviewSubmitLabel(action, busy),
    variant: reviewSubmitVariant(action),
  }
}

function reviewSubmitIcon(action: ResolvedContextualAction, busy: boolean) {
  return busy ? Loader2 : reviewActionIcon(action)
}

function reviewSubmitLabel(action: ResolvedContextualAction, busy: boolean) {
  if (busy) return 'Submitting…'
  return action.confirmation?.confirmLabel || action.label
}

function reviewSubmitVariant(action: ResolvedContextualAction) {
  return action.tone === 'destructive' ? ('destructive' as const) : ('default' as const)
}

const toneIcons: Partial<Record<NonNullable<ResolvedContextualAction['tone']>, LucideIcon>> = {
  positive: CheckCircle2,
  warning: ShieldAlert,
  destructive: ShieldAlert,
  neutral: MessageSquareText,
  default: MessageSquareText,
}

function reviewActionIcon(action: ResolvedContextualAction): LucideIcon {
  if (action.tone) return toneIcons[action.tone] || MessageSquareText
  if (action.id.includes('approve')) return CheckCircle2
  return action.id.includes('request') ? ShieldAlert : MessageSquareText
}

const toneIconClasses: Partial<Record<NonNullable<ResolvedContextualAction['tone']>, string>> = {
  positive: 'text-emerald-400',
  warning: 'text-amber-400',
  destructive: 'text-destructive',
  neutral: 'text-sky-400',
  default: 'text-sky-400',
}

function reviewActionIconClass(action: ResolvedContextualAction) {
  return (action.tone && toneIconClasses[action.tone]) || 'text-sky-400'
}

function reviewActionSelectedClass(action: ResolvedContextualAction) {
  if (action.tone === 'positive') return 'border-emerald-500/45 bg-emerald-500/8'
  if (action.tone === 'warning') return 'border-amber-500/45 bg-amber-500/8'
  if (action.tone === 'destructive') return 'border-destructive/45 bg-destructive/8'
  return 'border-primary/45 bg-primary/8'
}

function CommitReference({ entity }: { entity: ContextualActionEntity }) {
  const sha = String(entity.data.head_sha || '').slice(0, 7)
  return <strong className="font-mono font-medium text-foreground">{sha || 'the current revision'}</strong>
}
