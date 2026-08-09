import { useCallback } from 'react'
import { Loader2 } from 'lucide-react'

import { DiffReview } from '@vertexade/ui/components/diff-review'
import { Button } from '@vertexade/ui/components/ui/button'
import { TabsContent } from '@vertexade/ui/components/ui/tabs'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { JobDiffPreview } from '@vertexade/ui/lib/dashboard-types'
import type { ChatCodeSelection, DiffFileRevision } from '@vertexade/ui/lib/code-selection'

export function ThreadChanges({
  jobId,
  loading,
  error,
  preview,
  onRetry,
  onAddToChat,
}: {
  jobId: number | null
  loading: boolean
  error: string
  preview: JobDiffPreview | null
  onRetry: () => void
  onAddToChat?: (selection: ChatCodeSelection) => void
}) {
  const loadFile = useCallback(
    async (path: string, revision: DiffFileRevision) => {
      if (!jobId) throw new Error('Open a task before editing its changes')
      const source = await api<{ content: string }>(
        `/api/agent-threads/${jobId}/file?path=${encodeURIComponent(path)}&revision=${revision}`,
      )
      return source.content
    },
    [jobId],
  )

  return (
    <TabsContent value="changes" className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto p-3">
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          Loading changes…
        </div>
      ) : error ? (
        <div className="space-y-3 py-12 text-center text-sm text-red-400">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : preview ? (
        <div className="space-y-3">
          {preview.truncated && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[.06] p-3 text-xs text-amber-300">
              Large diff preview limited to keep this task responsive. {preview.omitted_files.length} oversized file
              {preview.omitted_files.length === 1 ? ' was' : 's were'} omitted; open the worktree or pull request for the complete diff.
            </div>
          )}
          <DiffReview
            patch={preview.diff}
            files={preview.diff_summary.files}
            onAddToChat={onAddToChat}
            loadFile={jobId ? loadFile : undefined}
          />
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-muted-foreground">Open this tab to load file changes.</div>
      )}
    </TabsContent>
  )
}
