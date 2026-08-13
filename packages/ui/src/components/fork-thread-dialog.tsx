import { useEffect, useState } from 'react'
import { CopyPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { api, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { Job } from '@vertexade/ui/lib/dashboard-types'

export function ForkThreadDialog({
  source,
  onOpenChange,
  onForked,
}: {
  source: Job | null
  onOpenChange: (open: boolean) => void
  onForked: (job: Job) => void
}) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [base, setBase] = useState<'current' | 'main'>('current')
  const [branchType, setBranchType] = useState('feature')
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<AgentLaunchOptions>({
    agentId: '',
    model: '',
    reasoningEffort: '',
    allowSubagents: false,
  })
  const workspaceOnly = source?.repository_source_kind === 'workspace'
  useEffect(() => {
    if (source) {
      setTitle('')
      setPrompt('')
      setBase('current')
      setBranchType('feature')
      setOptions({
        agentId: source.agent_id,
        model: '',
        reasoningEffort: '',
        allowSubagents: false,
      })
    }
  }, [source])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!source || !title.trim() || !prompt.trim()) return
    setBusy(true)
    try {
      const job = await api<Job>(`/api/agent-threads/${source.id}/fork`, {
        method: 'POST',
        headers: {
          'x-agent-provider': source.agent_id,
          ...(options.model ? { 'x-agent-model': options.model } : {}),
          ...(options.reasoningEffort ? { 'x-agent-reasoning-effort': options.reasoningEffort } : {}),
          ...(options.serviceTier ? { 'x-agent-service-tier': options.serviceTier } : {}),
          'x-agent-subagents': options.allowSubagents ? 'true' : 'false',
        },
        body: JSON.stringify({ title, prompt, base, branch_type: branchType }),
      })
      toast.success(workspaceOnly ? 'New isolated workspace and forked run started' : 'New branch, worktree, and forked run started')
      onForked(job)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{workspaceOnly ? 'Fork run into a new workspace' : 'Fork run into a new worktree'}</DialogTitle>
            <DialogDescription>
              The new {source?.agent_name || 'agent'} run keeps this run’s completed conversation history. Its work happens in a separate{' '}
              {workspaceOnly ? 'copy of the workspace' : 'branch and worktree'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!workspaceOnly && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Start from</Label>
                  <Select value={base} onValueChange={(value) => setBase(value as typeof base)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current branch</SelectItem>
                      <SelectItem value="main">Main / default branch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Branch type</Label>
                  <Select value={branchType} onValueChange={setBranchType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="feature">feature/</SelectItem>
                      <SelectItem value="fix">fix/</SelectItem>
                      <SelectItem value="chore">chore/</SelectItem>
                      <SelectItem value="refactor">refactor/</SelectItem>
                      <SelectItem value="test">test/</SelectItem>
                      <SelectItem value="docs">docs/</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Input
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short fork title"
            />
            <PromptImageTextarea
              required
              value={prompt}
              onValueChange={setPrompt}
              placeholder="What should the forked run work on?"
              className="min-h-32"
            />
            <AgentOptionsPicker lockedAgentId={source?.agent_id} value={options} onChange={setOptions} />
            <p className="break-all text-xs text-muted-foreground">Source: {source?.branch_name || source?.worktree_path}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !title.trim() || !prompt.trim()}>
              <CopyPlus />
              Fork and start
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
