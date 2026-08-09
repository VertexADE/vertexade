import { useEffect, useState } from 'react'
import type { PortableActionInput, PortableActionValue, PortableItemAction } from '@vertexade/platform-contracts'
import type { PlatformExtensionClient } from '@vertexade/platform-client'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { cn } from '@vertexade/ui/lib/utils'

export type PortableSourceData = Record<string, unknown>

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function inputDefault(input: PortableActionInput): PortableActionValue {
  if (input.defaultValue !== undefined) return input.defaultValue
  if (input.type === 'boolean') return false
  if (input.type === 'multiselect') return []
  return ''
}

export function PortableActionDialog({
  action,
  item,
  data,
  extension,
  onClose,
  onCompleted,
}: {
  action: PortableItemAction
  item: PortableCollectionItem | null
  data: PortableSourceData
  extension: PlatformExtensionClient
  onClose: () => void
  onCompleted: () => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, PortableActionValue>>({})
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [jobResult, setJobResult] = useState('')
  const [jobError, setJobError] = useState('')
  const [refinement, setRefinement] = useState('')
  const [mutationStatus, setMutationStatus] = useState<'idle' | 'sending' | 'refreshing' | 'failed'>('idle')
  const [mutationError, setMutationError] = useState('')
  useEffect(() => {
    const initial = Object.fromEntries(
      (action.inputs || []).map((input) => {
        const options = actionInputOptions(input, data, item)
        const declaredDefault = input.defaultPath
          ? readPortablePath(input.defaultSource === 'surface' ? data : item?.raw, input.defaultPath)
          : undefined
        const defaultValue =
          declaredDefault !== undefined
            ? typeof declaredDefault === 'number' || typeof declaredDefault === 'boolean'
              ? declaredDefault
              : String(declaredDefault)
            : options.length === 1 && input.optionValuePath
              ? String(readPortablePath(options[0], input.optionValuePath) || '')
              : inputDefault(input)
        return [input.name, defaultValue]
      }),
    )
    setValues(initial)
  }, [action, data, item])
  useEffect(() => {
    if (!jobId || !action.job || action.job.completedValues.includes(jobStatus) || action.job.failedValues.includes(jobStatus)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await extension.request(action.job!.statusPath.replaceAll('{jobId}', encodeURIComponent(jobId)))
        if (cancelled) return
        const status = String(readPortablePath(response, action.job!.statusValuePath) || '')
        setJobStatus(status)
        const result = readPortablePath(response, action.job!.resultPath)
        if (result !== undefined) setJobResult(JSON.stringify(result, null, 2))
        const error = readPortablePath(response, action.job!.errorPath)
        if (error) setJobError(String(error))
      } catch (reason) {
        if (!cancelled) setJobError(reason instanceof Error ? reason.message : 'Could not read workflow status')
      }
    }, action.job.pollIntervalMs || 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [action.job, extension, jobId, jobStatus])
  async function execute() {
    const missing = visibleInputs(action.inputs || [], values).find((input) => input.required && actionValueMissing(values[input.name]))
    if (missing) return toast.error(`${missing.label} is required`)
    setBusy(true)
    setMutationStatus('sending')
    setMutationError('')
    try {
      const response = await extension.executeAction(action, item || undefined, values)
      if (action.job) {
        const id = String(readPortablePath(response, action.job.idPath) || '')
        if (!id) throw new Error(`${action.label} did not return a workflow id`)
        setJobId(id)
        setJobStatus('queued')
        setMutationStatus('idle')
        toast.success(action.successMessage || `${action.label} started`)
      } else {
        setMutationStatus('refreshing')
        await onCompleted()
        toast.success(action.successMessage || `${action.label} completed`)
        onClose()
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${action.label} failed`
      setMutationStatus('failed')
      setMutationError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }
  async function completeWorkflow() {
    if (!action.job?.completeAction) return
    setBusy(true)
    try {
      const parsed = jobResult ? JSON.parse(jobResult) : null
      const resultName = '__workflow_result'
      const completeAction = {
        ...action.job.completeAction,
        inputs: [
          ...(action.job.completeAction.inputs || []),
          {
            name: resultName,
            label: 'Workflow result',
            type: 'hidden' as const,
            bodyPath: action.job.resultBodyPath || ['result'],
          },
        ],
      }
      const completeValues = Object.fromEntries(
        (action.job.completeAction.inputs || []).map((input) => [
          input.name,
          input.defaultPath
            ? normalizeActionValue(readPortablePath(input.defaultSource === 'item' ? item?.raw : data, input.defaultPath))
            : inputDefault(input),
        ]),
      )
      await extension.executeAction(completeAction, item || undefined, {
        ...completeValues,
        [resultName]: parsed,
      })
      setMutationStatus('refreshing')
      await onCompleted()
      toast.success(completeAction.successMessage || `${completeAction.label} completed`)
      onClose()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not complete workflow'
      setMutationStatus('failed')
      setMutationError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }
  async function refineWorkflow() {
    if (!action.job?.refineAction || !refinement.trim()) return
    setBusy(true)
    try {
      const refineAction = {
        ...action.job.refineAction,
        path: action.job.refineAction.path.replaceAll('{jobId}', encodeURIComponent(jobId)),
      }
      const response = await extension.executeAction(refineAction, item || undefined, {
        prompt: refinement,
      })
      const id = String(readPortablePath(response, action.job.idPath) || '')
      if (!id) throw new Error('Refinement did not return a workflow id')
      setJobId(id)
      setJobStatus('queued')
      setJobResult('')
      setJobError('')
      setRefinement('')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not refine workflow')
    } finally {
      setBusy(false)
    }
  }
  const jobComplete = Boolean(action.job && action.job.completedValues.includes(jobStatus))
  const jobFailed = Boolean(action.job && action.job.failedValues.includes(jobStatus))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={action.job ? 'max-h-[90vh] overflow-y-auto sm:max-w-3xl' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>{action.description || item?.title || 'Complete the extension action.'}</DialogDescription>
        </DialogHeader>
        {!jobId ? (
          <div className="space-y-4">
            {visibleInputs(action.inputs || [], values).map((input) => (
              <ActionInput
                key={input.name}
                input={input}
                data={data}
                item={item}
                values={values}
                value={values[input.name] ?? inputDefault(input)}
                onChange={(value) => setValues((current) => ({ ...current, [input.name]: value }))}
              />
            ))}
            {action.intent === 'launch-work' && <AgentOptionsPicker />}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-3">
              <p className="font-mono text-xs uppercase text-muted-foreground">Workflow status</p>
              <p className="mt-1 text-sm font-medium">{jobStatus || 'Starting…'}</p>
              {jobError && <p className="mt-2 text-sm text-destructive">{jobError}</p>}
            </div>
            {jobResult && (
              <Label>
                Review and edit the generated result
                <Textarea
                  className="mt-1 min-h-80 font-mono text-xs"
                  value={jobResult}
                  onChange={(event) => setJobResult(event.target.value)}
                />
              </Label>
            )}
            {jobComplete && action.job?.refineAction && (
              <Label>
                Refinement request
                <Textarea className="mt-1" value={refinement} onChange={(event) => setRefinement(event.target.value)} />
              </Label>
            )}
          </div>
        )}
        {mutationStatus !== 'idle' && (
          <div
            role="status"
            className={cn(
              'rounded-md border px-3 py-2 text-xs',
              mutationStatus === 'failed'
                ? 'border-destructive/35 bg-destructive/[.04] text-destructive'
                : 'border-blue-500/25 bg-blue-500/[.04] text-blue-300',
            )}
          >
            {mutationStatus === 'sending'
              ? 'Sending this update to the connected source…'
              : mutationStatus === 'refreshing'
                ? 'Source accepted the update. Refreshing the board…'
                : mutationError}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!jobId && (
            <Button loading={busy} loadingText="Starting…" onClick={() => void execute()}>
              {action.label}
            </Button>
          )}
          {jobComplete && action.job?.refineAction && (
            <Button variant="outline" disabled={busy || !refinement.trim()} onClick={() => void refineWorkflow()}>
              Refine
            </Button>
          )}
          {jobComplete && action.job?.completeAction && (
            <Button loading={busy} onClick={() => void completeWorkflow()}>
              {action.job.completeAction.label}
            </Button>
          )}
          {jobFailed && (
            <Button
              variant="outline"
              onClick={() => {
                setJobId('')
                setJobStatus('')
                setJobError('')
              }}
            >
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function normalizeActionValue(value: unknown): PortableActionValue {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(String)
  return String(value ?? '')
}

function actionValueMissing(value: PortableActionValue | undefined) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function actionInputOptions(input: PortableActionInput, data: PortableSourceData, item: PortableCollectionItem | null) {
  if (input.options?.length) return input.options
  return records(readPortablePath(input.optionsSource === 'item' ? item?.raw : data, input.optionsPath))
}

function conditionMatches(input: PortableActionInput, values: Record<string, PortableActionValue>) {
  if (!input.visibleWhen) return true
  const value = values[input.visibleWhen.input]
  if (input.visibleWhen.equals !== undefined) return value === input.visibleWhen.equals
  if (input.visibleWhen.notEquals !== undefined) return value !== input.visibleWhen.notEquals
  return Boolean(value)
}

function visibleInputs(inputs: PortableActionInput[], values: Record<string, PortableActionValue>) {
  return inputs.filter((input) => conditionMatches(input, values))
}

function ActionInput({
  input,
  data,
  item,
  values,
  value,
  onChange,
}: {
  input: PortableActionInput
  data: PortableSourceData
  item?: PortableCollectionItem | null
  values: Record<string, PortableActionValue>
  value: PortableActionValue
  onChange: (value: PortableActionValue) => void
}) {
  if (input.type === 'hidden') return null
  if (input.type === 'boolean')
    return (
      <Label className="flex items-center gap-2">
        <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} />
        {input.label}
      </Label>
    )
  if (input.type === 'select' || input.type === 'multiselect') {
    const options = actionInputOptions(input, data, item || null).filter(
      (option) =>
        !input.optionsFilterInput ||
        String(readPortablePath(option, input.optionsFilterPath) || ('parentValue' in option ? option.parentValue : '')) ===
          String(values[input.optionsFilterInput] || ''),
    )
    if (input.type === 'multiselect')
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{input.label}</legend>
          {options.map((option) => {
            const optionValue = String(readPortablePath(option, input.optionValuePath) || ('value' in option ? option.value : ''))
            const selected = Array.isArray(value) && value.includes(optionValue)
            return (
              <Label key={optionValue} className="flex items-center gap-2">
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...(Array.isArray(value) ? value : []), optionValue]
                        : (Array.isArray(value) ? value : []).filter((current) => current !== optionValue),
                    )
                  }
                />
                {String(readPortablePath(option, input.optionLabelPath) || ('label' in option ? option.label : optionValue))}
              </Label>
            )
          })}
        </fieldset>
      )
    return (
      <Label>
        {input.label}
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue placeholder={`Choose ${input.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => {
              const optionValue = String(readPortablePath(option, input.optionValuePath) || ('value' in option ? option.value : ''))
              return (
                <SelectItem key={optionValue} value={optionValue}>
                  {String(readPortablePath(option, input.optionLabelPath) || ('label' in option ? option.label : optionValue))}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </Label>
    )
  }
  if (input.type === 'textarea')
    return (
      <Label>
        {input.label}
        <Textarea
          className="mt-1 min-h-28"
          placeholder={input.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      </Label>
    )
  return (
    <Label>
      {input.label}
      <Input
        className="mt-1"
        type={input.type === 'number' ? 'number' : 'text'}
        placeholder={input.placeholder}
        value={String(value)}
        onChange={(event) => onChange(input.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </Label>
  )
}
