import { useState } from 'react'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { ThreadRuntimeDefaults } from './settings-types'

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
    <Card className="gap-0 py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Bot className="size-4" />
          Thread defaults
        </CardTitle>
        <CardDescription>Default provider, model, and reasoning level when a thread does not override them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Work items</h3>
          <AgentOptionsPicker
            value={draft.workItem}
            onChange={(workItem) => setDraft((current) => ({ ...current, workItem }))}
            showSubagents={false}
          />
        </section>
        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Reviews</h3>
          <AgentOptionsPicker
            value={draft.review}
            onChange={(review) => setDraft((current) => ({ ...current, review }))}
            showSubagents={false}
          />
        </section>
        <Button className="w-full sm:w-auto" size="sm" disabled={busy || !draft.workItem.agentId || !draft.review.agentId} onClick={save}>
          {busy ? 'Saving…' : 'Save thread defaults'}
        </Button>
      </CardContent>
    </Card>
  )
}
