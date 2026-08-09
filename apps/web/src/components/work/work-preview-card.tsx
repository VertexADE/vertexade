import { useState } from 'react'
import { Container } from 'lucide-react'
import { WorktreePreviewPanel } from '@vertexade/ui/components/worktree-preview-panel'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

function previewableWorktreeJobs(item: WorkItem) {
  return item.threads.filter((job) => !job.worktree_removed_at && !['work_review', 'stack_analysis', 'azure_planning'].includes(job.kind))
}

type PreviewWorktreeJob = ReturnType<typeof previewableWorktreeJobs>[number]

function PreviewWorktreeChoice({
  threads,
  selected,
  onChange,
}: {
  threads: PreviewWorktreeJob[]
  selected: PreviewWorktreeJob
  onChange: (jobId: number) => void
}) {
  if (threads.length === 1)
    return (
      <Badge variant="outline" className="w-fit sm:justify-self-end">
        {selected.full_name} · thread #{selected.id}
      </Badge>
    )
  return (
    <Select value={String(selected.id)} onValueChange={(value) => onChange(Number(value))}>
      <SelectTrigger className="h-11 w-full sm:h-8" aria-label="Preview worktree">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {threads.map((thread) => (
          <SelectItem key={thread.id} value={String(thread.id)}>
            {thread.full_name} · thread #{thread.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function selectedPreviewJob(threads: PreviewWorktreeJob[], jobId: number) {
  return threads.find((thread) => thread.id === jobId) || threads[0]
}

export function WorkItemPreviewCard({ item }: { item: WorkItem }) {
  const threads = previewableWorktreeJobs(item)
  const [jobId, setJobId] = useState(0)
  const selected = selectedPreviewJob(threads, jobId)
  if (!selected) return null
  return (
    <Card id="previews" className="scroll-mt-32 border-blue-500/25 bg-blue-500/[.02]">
      <CardHeader className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,.45fr)]">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Container className="size-4 text-blue-400" />
            Container preview
          </CardTitle>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Build and inspect this Work item's repository worktree without opening its agent thread.
          </p>
        </div>
        <PreviewWorktreeChoice threads={threads} selected={selected} onChange={setJobId} />
      </CardHeader>
      <CardContent>
        <WorktreePreviewPanel key={selected.id} threadId={selected.id} />
      </CardContent>
    </Card>
  )
}
