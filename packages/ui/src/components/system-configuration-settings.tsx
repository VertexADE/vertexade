import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { MessageSquareText, SlidersHorizontal, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { backendApi } from '../lib/dashboard-api'

export type SystemConfigurationValue = {
  prompts: { work: string; review: string; planning: string; followUp: string; scheduled: string }
  tools: Record<'git' | 'gh' | 'codex' | 'claude' | 'opencode' | 'pnpm' | 'mise' | 'pm2' | 'docker' | 'fallow', string>
  runtime: {
    capabilityTimeoutMs: number
    retryAttempts: number
    retryDelayMs: number
    automationMaxSteps: number
    automationMaxConcurrentRuns: number
  }
}

export const emptySystemConfiguration: SystemConfigurationValue = {
  prompts: { work: '', review: '', planning: '', followUp: '', scheduled: '' },
  tools: { git: '', gh: '', codex: '', claude: '', opencode: '', pnpm: '', mise: '', pm2: '', docker: '', fallow: '' },
  runtime: {
    capabilityTimeoutMs: 30_000,
    retryAttempts: 1,
    retryDelayMs: 250,
    automationMaxSteps: 20,
    automationMaxConcurrentRuns: 4,
  },
}

const promptFields = [
  ['work', 'Work runs', 'Applied to new implementation and investigation runs.'],
  ['review', 'Review runs', 'Adds workspace-specific checks without replacing the locked review and security contract.'],
  ['planning', 'Planning runs', 'Applied to extension-provided planning, decomposition, and refinement turns.'],
  ['followUp', 'Follow-up turns', 'Applied when continuing a non-review agent run.'],
  ['scheduled', 'Recurring automations', 'Applied to recurring automation runs after the locked safety boundary.'],
] as const

export function PromptPolicySettings({
  value,
  onSaved,
  backendId,
}: {
  value: SystemConfigurationValue
  onSaved(value: SystemConfigurationValue): void
  backendId: string
}) {
  const form = useForm({
    defaultValues: value.prompts,
    onSubmit: async ({ value: prompts }) => {
      try {
        const saved = await backendApi<SystemConfigurationValue>(backendId, '/api/settings/system-configuration', {
          method: 'POST',
          body: JSON.stringify({ ...value, prompts }),
        })
        onSaved(saved)
        toast.success('Prompt policies saved')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  useEffect(() => form.reset(value.prompts), [value.prompts])
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquareText className="size-4" />
          Workspace prompt policies
        </CardTitle>
        <CardDescription>
          Append trusted workspace instructions to each workflow. Core safety, scope, and review requirements remain locked and cannot be
          removed here.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="space-y-2 p-3 sm:space-y-4 sm:p-4"
      >
        {promptFields.map(([key, label, description]) => (
          <details key={key} className="group rounded-lg border bg-background/25">
            <summary data-audit-action={`settings.prompt.${key}.edit`} className="cursor-pointer list-none px-3 py-2.5 marker:hidden">
              <span className="flex items-center justify-between gap-3 text-xs font-medium">
                {label}
                <span className="text-[11px] font-normal text-primary group-open:hidden">Edit</span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{description}</span>
            </summary>
            <Label className="flex-col items-stretch gap-1.5 border-t p-3">
              <span className="sr-only">{label}</span>
              <form.Field name={key}>
                {(field) => (
                  <Textarea
                    maxLength={20_000}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="No additional workspace instructions"
                    className="min-h-28 text-xs"
                  />
                )}
              </form.Field>
            </Label>
          </details>
        ))}
        <div className="flex justify-end pt-1">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <Button className="w-full sm:w-auto" disabled={busy}>
                {busy ? 'Saving…' : 'Save prompt policies'}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Card>
  )
}

const toolFields = [
  ['git', 'Git'],
  ['gh', 'GitHub CLI'],
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['opencode', 'OpenCode'],
  ['pnpm', 'pnpm'],
  ['mise', 'mise'],
  ['pm2', 'PM2'],
  ['docker', 'Docker'],
  ['fallow', 'Fallow'],
] as const

export function ToolPathSettings({
  value,
  onSaved,
  backendId,
}: {
  value: SystemConfigurationValue
  onSaved(value: SystemConfigurationValue): void
  backendId: string
}) {
  const form = useForm({
    defaultValues: value.tools,
    onSubmit: async ({ value: tools }) => {
      try {
        const saved = await backendApi<SystemConfigurationValue>(backendId, '/api/settings/system-configuration', {
          method: 'POST',
          body: JSON.stringify({ ...value, tools }),
        })
        onSaved(saved)
        toast.success('Tool paths saved')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  useEffect(() => form.reset(value.tools), [value.tools])
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="size-4" />
          Tool executable paths
        </CardTitle>
        <CardDescription>
          Override executables used by setup checks, repository operations, and agent runs. Leave a field empty to resolve it from PATH.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="grid gap-4 p-4 sm:grid-cols-2"
      >
        {toolFields.map(([key, label]) => (
          <Label key={key} className="flex-col items-stretch gap-1.5">
            <span className="text-xs font-medium">{label}</span>
            <form.Field name={key}>
              {(field) => (
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={`Path or ${key}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </form.Field>
          </Label>
        ))}
        <div className="flex justify-end sm:col-span-2">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => <Button disabled={busy}>{busy ? 'Saving…' : 'Save tool paths'}</Button>}
          </form.Subscribe>
        </div>
      </form>
    </Card>
  )
}

export function RuntimeSettings({
  value,
  onSaved,
  backendId,
}: {
  value: SystemConfigurationValue
  onSaved(value: SystemConfigurationValue): void
  backendId: string
}) {
  const form = useForm({
    defaultValues: value.runtime,
    onSubmit: async ({ value: runtime }) => {
      try {
        const saved = await backendApi<SystemConfigurationValue>(backendId, '/api/settings/system-configuration', {
          method: 'POST',
          body: JSON.stringify({ ...value, runtime }),
        })
        onSaved(saved)
        toast.success('Runtime defaults saved')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  useEffect(() => form.reset(value.runtime), [value.runtime])
  const numberField = (key: keyof SystemConfigurationValue['runtime'], label: string, minimum: number, maximum: number, hint: string) => (
    <Label className="flex-col items-stretch gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <form.Field
        name={key}
        validators={{
          onChange: ({ value }) =>
            Number.isInteger(value) && value >= minimum && value <= maximum ? undefined : `Use a value from ${minimum} to ${maximum}`,
        }}
      >
        {(field) => (
          <Input
            type="number"
            min={minimum}
            max={maximum}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(Number(event.target.value))}
          />
        )}
      </form.Field>
      <small className="text-[10px] text-muted-foreground">{hint}</small>
    </Label>
  )
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <SlidersHorizontal className="size-4" />
          Extension runtime defaults
        </CardTitle>
        <CardDescription>
          Guarded fallbacks used when an extension capability or automation recipe does not declare a stricter value. Provider aspects are
          declared by extensions and resolved automatically per operation.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="grid gap-4 p-4 sm:grid-cols-2"
      >
        {numberField('capabilityTimeoutMs', 'Capability timeout (ms)', 100, 3_600_000, '100 ms to 60 minutes.')}
        {numberField('retryAttempts', 'Default attempts', 1, 10, 'Includes the first attempt.')}
        {numberField('retryDelayMs', 'Retry delay (ms)', 0, 60_000, 'Delay between failed attempts.')}
        {numberField('automationMaxSteps', 'Maximum recipe steps', 1, 100, 'Applied when recipes are created or edited.')}
        {numberField('automationMaxConcurrentRuns', 'Concurrent automation flows', 1, 32, 'Hard ceiling for active flows.')}
        <div className="flex justify-end sm:col-span-2">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, busy]) => <Button disabled={!canSubmit || busy}>{busy ? 'Saving…' : 'Save runtime defaults'}</Button>}
          </form.Subscribe>
        </div>
      </form>
    </Card>
  )
}
