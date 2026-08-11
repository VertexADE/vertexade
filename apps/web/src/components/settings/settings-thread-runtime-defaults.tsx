import { useState } from 'react'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Separator } from '@vertexade/ui/components/ui/separator'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { ThreadRuntimeDefaults } from './settings-types'

function threadDefaultsReady(draft: ThreadRuntimeDefaults): boolean {
  return Boolean(draft.workItem.agentId && draft.review.agentId)
}

function saveThreadDefaultsDisabled(draft: ThreadRuntimeDefaults, busy: boolean): boolean {
  return busy || !threadDefaultsReady(draft)
}

function SaveThreadDefaultsContent({ busy }: { busy: boolean }) {
  if (busy)
    return (
      <>
        <Spinner data-icon="inline-start" />
        Saving…
      </>
    )
  return <>Save thread defaults</>
}

function SaveThreadDefaultsButton({ draft, busy, onSave }: { draft: ThreadRuntimeDefaults; busy: boolean; onSave(): void }) {
  return (
    <Button className="w-full sm:w-auto" size="sm" disabled={saveThreadDefaultsDisabled(draft, busy)} onClick={onSave}>
      <SaveThreadDefaultsContent busy={busy} />
    </Button>
  )
}

export function ThreadRuntimeDefaultSettings({
  value,
  onSaved,
}: {
  value: ThreadRuntimeDefaults
  onSaved(value: ThreadRuntimeDefaults): void
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const saved = await api<ThreadRuntimeDefaults>('/api/settings/thread-runtime-defaults', {
        method: 'POST',
        body: JSON.stringify(draft),
      })
      setDraft(saved)
      onSaved(saved)
      toast.success('Thread defaults saved')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot />
          Thread defaults
        </CardTitle>
        <CardDescription>Default provider, model, and reasoning level when a thread does not override them.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Work items</h3>
          <AgentOptionsPicker
            value={draft.workItem}
            onChange={(workItem) => setDraft((current) => ({ ...current, workItem }))}
            showSubagents={false}
          />
        </section>
        <Separator />
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Reviews</h3>
          <AgentOptionsPicker
            value={draft.review}
            onChange={(review) => setDraft((current) => ({ ...current, review }))}
            showSubagents={false}
          />
        </section>
      </CardContent>
      <CardFooter className="justify-end">
        <SaveThreadDefaultsButton draft={draft} busy={busy} onSave={() => void save()} />
      </CardFooter>
    </Card>
  )
}
