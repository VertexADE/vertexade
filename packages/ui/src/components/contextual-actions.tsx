import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { CapabilityExecution, ContextualActionPlacement, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { Button } from '@vertexade/ui/components/ui/button'
import { ButtonGroup } from '@vertexade/ui/components/ui/button-group'
import { ContextualActionField } from '@vertexade/ui/components/contextual-action-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@vertexade/ui/components/ui/tooltip'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import {
  contextualActionIdempotencyKey,
  contextualActions,
  contextualConfirmationValue,
  type ContextualActionEntity,
  type ResolvedContextualAction,
} from '@vertexade/ui/lib/contextual-actions'
import { ReviewActionComposer } from '@vertexade/ui/components/review-action-composer'

type Props = {
  modules: ModuleCatalogEntry[]
  entity: ContextualActionEntity
  placement: ContextualActionPlacement
  mode?: 'primary' | 'menu' | 'sheet'
  showDisabledReason?: boolean
  onCompleted?: (execution: CapabilityExecution, action: ResolvedContextualAction) => void | Promise<void>
}

type ActionMode = NonNullable<Props['mode']>
type ActionCompletion = Props['onCompleted']
type ActionRunner = ReturnType<typeof useContextualActionRunner>

function failure(execution: CapabilityExecution) {
  return !['succeeded'].includes(execution.status)
}

function useContextualActionRunner(entity: ContextualActionEntity, onCompleted: ActionCompletion) {
  const [pending, setPending] = useState<ResolvedContextualAction | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  async function execute(action: ResolvedContextualAction) {
    setBusy(action.id)
    try {
      const execution = await backendApi<CapabilityExecution>(
        typeof entity.data.backend_id === 'string' ? entity.data.backend_id : null,
        `/api/capabilities/action/${encodeURIComponent(action.capabilityId)}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            input: { ...action.input, ...fieldValues },
            idempotencyKey: contextualActionIdempotencyKey(action, entity),
            context: { actionId: action.id, entityKind: entity.kind, entityKey: entity.key },
          }),
        },
      )
      if (failure(execution)) throw new Error(execution.error || `${action.label} failed`)
      toast.success(action.successMessage || `${action.label} completed`)
      setPending(null)
      setSheetOpen(false)
      setConfirmation('')
      setFieldValues({})
      await onCompleted?.(execution, action)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${action.label} failed`)
    } finally {
      setBusy(null)
    }
  }

  function select(action: ResolvedContextualAction) {
    if (!action.enabled) return
    setSheetOpen(false)
    if ((!action.confirmation || action.confirmation.level === 'none') && !action.inputFields?.length) void execute(action)
    else {
      setConfirmation('')
      setFieldValues({})
      setPending(action)
    }
  }

  return {
    busy,
    confirmation,
    fieldValues,
    pending,
    sheetOpen,
    execute,
    select,
    setConfirmation,
    setFieldValues,
    setPending,
    setSheetOpen,
  }
}

export function ContextualActions({ modules, entity, placement, mode = 'primary', showDisabledReason = false, onCompleted }: Props) {
  const backendId = typeof entity.data.backend_id === 'string' ? entity.data.backend_id : null
  const [ownerModules, setOwnerModules] = useState<ModuleCatalogEntry[] | null>(null)
  useEffect(() => {
    if (!backendId) {
      setOwnerModules(null)
      return
    }
    let active = true
    void backendApi<{ modules: ModuleCatalogEntry[] }>(backendId, '/api/modules')
      .then((catalog) => {
        if (active) setOwnerModules(catalog.modules)
      })
      .catch(() => {
        if (active) setOwnerModules(null)
      })
    return () => {
      active = false
    }
  }, [backendId])
  const actions = useMemo(() => contextualActions(ownerModules || modules, entity, placement), [entity, modules, ownerModules, placement])
  const runner = useContextualActionRunner(entity, onCompleted)
  if (!actions.length) return null

  return (
    <>
      <ContextualActionPresentation actions={actions} entity={entity} mode={mode} runner={runner} showDisabledReason={showDisabledReason} />
      <ContextualActionConfirmation entity={entity} runner={runner} />
    </>
  )
}

function ContextualActionPresentation({
  actions,
  entity,
  mode,
  runner,
  showDisabledReason,
}: {
  actions: ResolvedContextualAction[]
  entity: ContextualActionEntity
  mode: ActionMode
  runner: ActionRunner
  showDisabledReason: boolean
}) {
  if (mode === 'menu') return <ContextualActionMenu actions={actions} runner={runner} />
  if (mode === 'sheet') return <ReviewActionComposer actions={actions} entity={entity} runner={runner} />
  return <ContextualActionPrimary actions={actions} runner={runner} showDisabledReason={showDisabledReason} />
}

function ContextualActionMenu({ actions, runner }: { actions: ResolvedContextualAction[]; runner: ActionRunner }) {
  return actions.map((action) => (
    <DropdownMenuItem
      key={`${action.moduleId}:${action.id}`}
      disabled={!action.enabled || Boolean(runner.busy)}
      onSelect={() => runner.select(action)}
    >
      {runner.busy === action.id ? <Loader2 className="animate-spin" /> : <Zap />}
      <span className="min-w-0">
        <span className="block truncate">{action.label}</span>
        {action.disabledReason && <small className="block truncate text-muted-foreground">{action.disabledReason}</small>}
      </span>
    </DropdownMenuItem>
  ))
}

function ContextualActionPrimary({
  actions,
  runner,
  showDisabledReason,
}: {
  actions: ResolvedContextualAction[]
  runner: ActionRunner
  showDisabledReason: boolean
}) {
  const [primary, ...secondary] = actions
  return (
    <div className="min-w-0">
      <ButtonGroup>
        <ActionButton action={primary} busy={runner.busy === primary.id} onSelect={() => runner.select(primary)} />
        {secondary.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" disabled={Boolean(runner.busy)} aria-label="More recommended actions">
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {secondary.map((action) => (
                <DropdownMenuItem
                  key={`${action.moduleId}:${action.id}`}
                  disabled={!action.enabled || Boolean(runner.busy)}
                  onSelect={() => runner.select(action)}
                >
                  <Zap />
                  <span>
                    <span className="block">{action.label}</span>
                    {action.description && <small className="block text-muted-foreground">{action.description}</small>}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ButtonGroup>
      {showDisabledReason && primary.disabledReason && (
        <p className="mt-1 line-clamp-1 text-[10px] leading-tight text-amber-400" title={primary.disabledReason}>
          {primary.disabledReason}
        </p>
      )}
    </div>
  )
}

function ContextualActionConfirmation({ entity, runner }: { entity: ContextualActionEntity; runner: ActionRunner }) {
  const pending = runner.pending
  if (!pending) return null
  const typedValue = contextualConfirmationValue(pending, entity)
  const confirmed = actionFieldsComplete(pending, runner.fieldValues) && actionConfirmationMatches(pending, runner.confirmation, typedValue)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !runner.busy) {
          runner.setPending(null)
          runner.setConfirmation('')
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!runner.busy}>
        <DialogHeader>
          <DialogTitle>{actionConfirmationTitle(pending)}</DialogTitle>
          <DialogDescription>{actionConfirmationDescription(pending)}</DialogDescription>
        </DialogHeader>
        {(pending.inputFields || []).map((field) => (
          <ContextualActionField
            key={field.name}
            field={field}
            value={runner.fieldValues[field.name] ?? ''}
            disabled={Boolean(runner.busy)}
            onChange={(value) => runner.setFieldValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
        <TypedActionConfirmation action={pending} typedValue={typedValue} runner={runner} />
        <DialogFooter>
          <Button variant="outline" disabled={Boolean(runner.busy)} onClick={() => runner.setPending(null)}>
            Cancel
          </Button>
          <ContextualActionSubmit action={pending} confirmed={confirmed} runner={runner} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContextualActionSubmit({
  action,
  confirmed,
  runner,
}: {
  action: ResolvedContextualAction
  confirmed: boolean
  runner: ActionRunner
}) {
  const busy = Boolean(runner.busy)
  return (
    <Button
      variant={actionButtonVariant(action)}
      disabled={actionSubmitDisabled(confirmed, busy)}
      onClick={() => void runner.execute(action)}
    >
      <BusyActionIcon busy={busy} icon={Zap} />
      {busyActionLabel(busy, 'Running…', actionConfirmationLabel(action))}
    </Button>
  )
}

function actionButtonVariant(action: ResolvedContextualAction) {
  return action.tone === 'destructive' ? ('destructive' as const) : ('default' as const)
}

function actionSubmitDisabled(confirmed: boolean, busy: boolean) {
  return !confirmed || busy
}

function busyActionLabel(busy: boolean, busyLabel: string, label: string) {
  return busy ? busyLabel : label
}

function actionFieldsComplete(action: ResolvedContextualAction, fieldValues: Record<string, string>) {
  return (action.inputFields || []).every((field) => !field.required || Boolean(fieldValues[field.name]?.trim()))
}

function actionConfirmationMatches(action: ResolvedContextualAction, confirmation: string, typedValue: string) {
  return action.confirmation?.level !== 'typed' || confirmation === typedValue
}

function actionConfirmationTitle(action: ResolvedContextualAction) {
  return action.confirmation?.title || action.label
}

function actionConfirmationDescription(action: ResolvedContextualAction) {
  return action.confirmation?.description || action.description || `Run this action through ${action.moduleName}?`
}

function actionConfirmationLabel(action: ResolvedContextualAction) {
  return action.confirmation?.confirmLabel || action.label
}

function TypedActionConfirmation({
  action,
  typedValue,
  runner,
}: {
  action: ResolvedContextualAction
  typedValue: string
  runner: ActionRunner
}) {
  if (action.confirmation?.level !== 'typed') return null
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Type <strong className="font-mono text-foreground">{typedValue}</strong> to confirm.
      </p>
      <Input
        autoFocus
        value={runner.confirmation}
        disabled={Boolean(runner.busy)}
        onChange={(event) => runner.setConfirmation(event.target.value)}
      />
    </div>
  )
}

function BusyActionIcon({ busy, icon: Icon }: { busy: boolean; icon: typeof Zap }) {
  if (busy) return <Loader2 className="size-4 animate-spin" />
  return <Icon className="size-4" />
}

function ActionButton({ action, busy, onSelect }: { action: ResolvedContextualAction; busy: boolean; onSelect(): void }) {
  const icon = busy ? <Loader2 className="animate-spin" /> : <Zap />
  const label = busy ? 'Running…' : action.label
  const button = (
    <Button disabled={!action.enabled || busy} variant={action.tone === 'destructive' ? 'destructive' : 'default'} onClick={onSelect}>
      {icon}
      {label}
    </Button>
  )
  if (!action.disabledReason) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{action.disabledReason}</TooltipContent>
    </Tooltip>
  )
}
