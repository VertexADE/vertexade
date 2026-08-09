import { useState } from 'react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { api, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { ContentGenerationSettings } from './settings-types'

const generationLaunchOptions = (settings: ContentGenerationSettings): AgentLaunchOptions => ({
  agentId: settings.agentId,
  model: settings.model,
  reasoningEffort: settings.reasoningEffort,
  serviceTier: settings.serviceTier || '',
  allowSubagents: false,
})

export function ContentGenerationDefaults({
  value,
  onSaved,
}: {
  value: ContentGenerationSettings
  onSaved: (value: ContentGenerationSettings) => void
}) {
  const [options, setOptions] = useState<AgentLaunchOptions>(() => generationLaunchOptions(value))
  const [busy, setBusy] = useState(false)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const saved = await api<ContentGenerationSettings>('/api/settings/content-generation', {
        method: 'POST',
        body: JSON.stringify({
          agentId: options.agentId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          serviceTier: options.serviceTier || '',
        }),
      })
      onSaved(saved)
      toast.success('Read-only generation default saved')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 font-mono text-sm">
              <Sparkles className="size-4" />
              Generated text
            </CardTitle>
            <CardDescription className="mt-1">
              Default provider, model, and reasoning level for lightweight titles, summaries, labels, and other generated metadata.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-500/35 text-emerald-400">
            <ShieldCheck />
            Read-only
          </Badge>
        </div>
      </CardHeader>
      <form onSubmit={save} className="space-y-3 p-4">
        <AgentOptionsPicker nativeOnly readOnlyOnly value={options} onChange={setOptions} />
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[.04] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Permission is fixed.</strong> Metadata generation can inspect supplied context, but cannot
            edit source files or write to external services. This does not change normal work-agent defaults.
          </p>
          <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={busy || !options.agentId}>
            {busy ? 'Saving…' : 'Save generation default'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
