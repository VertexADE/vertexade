import { useEffect } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'

export type AgentEnvironment = {
  id: string
  name: string
  variables: { name: string; has_value: boolean }[]
}
type EnvironmentRow = { id: string; name: string; value: string; previousName: string }

function environmentRows(agent: AgentEnvironment): EnvironmentRow[] {
  return agent.variables.map((variable) => ({
    id: nanoid(),
    name: variable.name,
    value: '',
    previousName: variable.name,
  }))
}

function EnvironmentCardHeader({ agent }: { agent: AgentEnvironment }) {
  return (
    <CardHeader className="border-b p-4">
      <CardTitle className="flex items-center gap-2 text-sm">
        <ShieldCheck className="size-4" />
        {agent.name}
      </CardTitle>
      <CardDescription>
        Values are encrypted in SQLite, never returned to the browser, and decrypted server-side only when launching {agent.name}.
      </CardDescription>
    </CardHeader>
  )
}

export function AgentEnvironmentSettingsPanel({
  agent,
  onChanged,
  saveEnvironment,
}: {
  agent: AgentEnvironment
  onChanged: () => void
  saveEnvironment(input: { variables: { name: string; value: string; previous_name: string }[] }): Promise<unknown>
}) {
  const form = useForm({
    defaultValues: { rows: environmentRows(agent) },
    onSubmit: async ({ value }) => {
      try {
        await saveEnvironment({
          variables: value.rows.map((row) => ({
            name: row.name.trim(),
            value: row.value,
            previous_name: row.previousName,
          })),
        })
        toast.success(`${agent.name} environment stored encrypted`)
        onChanged()
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const rows = useStore(form.store, (state) => state.values.rows)
  useEffect(() => {
    form.reset({ rows: environmentRows(agent) })
  }, [agent])
  function update(id: string, values: Partial<EnvironmentRow>) {
    form.setFieldValue('rows', (current) => current.map((row) => (row.id === id ? { ...row, ...values } : row)))
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <EnvironmentCardHeader agent={agent} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="space-y-3 p-4"
      >
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
              <Label className="flex-col items-stretch gap-1">
                <span className="text-xs uppercase text-muted-foreground">Name</span>
                <Input
                  required
                  maxLength={128}
                  autoComplete="off"
                  className="font-mono"
                  value={row.name}
                  onChange={(event) => update(row.id, { name: event.target.value })}
                  placeholder="API_TOKEN"
                />
              </Label>
              <Label className="flex-col items-stretch gap-1">
                <span className="text-xs uppercase text-muted-foreground">Secret value</span>
                <Input
                  required={!row.previousName}
                  maxLength={20_000}
                  type="password"
                  autoComplete="new-password"
                  value={row.value}
                  onChange={(event) => update(row.id, { value: event.target.value })}
                  placeholder={row.previousName ? 'Stored securely · leave blank to keep current value' : 'Enter value'}
                />
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-end text-red-400 sm:col-span-2"
                onClick={() => form.setFieldValue('rows', (current) => current.filter((item) => item.id !== row.id))}
              >
                <Trash2 />
                Remove<span className="sr-only"> {row.name || 'variable'}</span>
              </Button>
            </div>
          ))}
        </div>
        {!rows.length && (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No custom variables configured. Saving this state clears the encrypted environment for {agent.name}.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => form.setFieldValue('rows', (current) => [...current, { id: nanoid(), name: '', value: '', previousName: '' }])}
          >
            <Plus />
            Add variable
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <Button size="sm" disabled={busy}>
                {busy ? 'Saving…' : `Save ${agent.name} environment`}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Card>
  )
}
