import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { resourceReference } from '@vertexade/ui/components/work-reference-picker'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository, WorkItem, WorkLaunchResult, WorkReferenceSelection } from '@vertexade/ui/lib/dashboard-types'

export function useStartThreadDialog({
  item,
  open,
  onOpenChange,
  onStarted,
}: {
  item: WorkItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: () => void
}) {
  const [prompt, setPrompt] = useState(item.description)
  const [createPr, setCreatePr] = useState(true)
  const [splitWorkItem, setSplitWorkItem] = useState(false)
  const [repositories, setRepositories] = useState<Pick<Repository, 'id' | 'full_name'>[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [references, setReferences] = useState<WorkReferenceSelection[]>([])
  const [busy, setBusy] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [resourceSelection, setResourceSelection] = useAgentResourceSelection()
  useEffect(() => {
    if (!open) return
    setResourceSelection(null)
    setPrompt(item.description)
    setSplitWorkItem(item.sequential_execution)
    setReferences(item.resources.filter((resource) => resource.role === 'context').map(resourceReference))
    const scoped = item.resources
      .filter((resource) => resource.kind === 'repository' && resource.repository_id)
      .map((resource) => Number(resource.repository_id))
    const initialRepositories = [...new Set(scoped.length ? scoped : [item.primary_repository_id].filter(Boolean).map(Number))]
    setSelected(initialRepositories)
    setCreatePr(Boolean(initialRepositories.length))
    if (item.kind !== 'pr_review')
      void api<{ repositories: Pick<Repository, 'id' | 'full_name'>[] }>('/api/work-repositories')
        .then((result) => setRepositories(result.repositories))
        .catch((error) => toast.error((error as Error).message))
  }, [item.description, item.id, item.kind, item.primary_repository_id, item.resources, item.sequential_execution, open])
  async function submit() {
    setBusy(true)
    try {
      if (item.kind === 'pr_review') {
        const result = await api<{ threads?: { id: number }[] }>(`/api/work-items/${item.id}/threads`, {
          method: 'POST',
          body: JSON.stringify(resourceSelection ? { resource_selection: resourceSelection } : {}),
        })
        toast.success(`Review started${result.threads?.[0]?.id ? ` as thread #${result.threads[0].id}` : ''}`)
      } else {
        const result = await api<WorkLaunchResult>(`/api/work-items/${item.id}/threads`, {
          method: 'POST',
          body: JSON.stringify({
            repository_ids: selected,
            prompt,
            references,
            replace_context_references: true,
            create_pr: createPr,
            split_work_item: splitWorkItem,
            ...(resourceSelection ? { resource_selection: resourceSelection } : {}),
          }),
        })
        if (result.errors.length) toast.warning('The agent could not start and needs attention')
        else toast.success('Agent thread started')
      }
      onOpenChange(false)
      onStarted()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return {
    prompt,
    setPrompt,
    createPr,
    setCreatePr,
    splitWorkItem,
    setSplitWorkItem,
    repositories,
    selected,
    setSelected: (value: number[]) => {
      setSelected(value)
      if (!value.length) setCreatePr(false)
    },
    references,
    setReferences,
    busy,
    uploadingImages,
    setUploadingImages,
    resourceSelection,
    setResourceSelection,
    contributorReview: item.kind === 'pr_review',
    submit,
  }
}
