import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, Job, JobLog } from '@vertexade/ui/lib/dashboard-types'

export function ReviewHandoffDialog({
  job,
  presentation,
  onOpenChange,
  onSent,
}: {
  job: JobLog | null
  presentation: DashboardData['presentation']
  onOpenChange: (open: boolean) => void
  onSent: (id: number) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (job) setPrompt('')
  }, [job])
  async function submit() {
    if (!job || !prompt.trim()) return
    setBusy(true)
    try {
      const next = await api<Job>(`/api/agent-threads/${job.id}/handoff`, {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      toast.success(`Findings handed to new ${presentation.defaultAgent.name} run #${next.id}`)
      onSent(next.id)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(job)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Steer a new {presentation.defaultAgent.name} with these findings</DialogTitle>
          <DialogDescription>
            The private review remains unchanged. A separate worktree and agent session will validate the findings before following your
            instruction.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              setPrompt(
                'Re-evaluate and refine these findings. Remove false positives, improve the explanations and remediation, and return an updated private review without posting it anywhere.',
              )
            }
          >
            Refine privately
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              setPrompt(
                `Revalidate every finding, then post the valid findings to ${presentation.scm.name} as a ${presentation.scm.changeRequestLabel} review. Do not post false positives or internal process notes.`,
              )
            }
          >
            Prepare and post to {presentation.scm.name}
          </Button>
        </div>
        <PromptImageTextarea
          value={prompt}
          onValueChange={setPrompt}
          placeholder={`Tell the new ${presentation.defaultAgent.name} what to do and paste supporting images…`}
          className="min-h-36"
        />
        <AgentOptionsPicker />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!prompt.trim() || busy} onClick={submit}>
            <GitBranch />
            Start separate {presentation.defaultAgent.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
