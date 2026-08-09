import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { WorkBoardData, WorkItem, WorkReferenceSelection } from '@vertexade/ui/lib/dashboard-types'
import {
  clearNewWorkDraft,
  launchCreatedWork,
  notifyWorkCreated,
  notifyWorkLaunchRecovery,
  readNewWorkDraft,
  readWorkLaunchPreferences,
  rememberWorkLaunchPreferences,
  requestGeneratedWorkTitle,
  resourceSelectionPayload,
  suggestedWorkRepositories,
  writeNewWorkDraft,
} from './new-work-service'

export function useNewWorkDialog({
  open,
  onOpenChange,
  data,
  onCreated,
  initialStartThread,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: WorkBoardData
  onCreated: () => void
  initialStartThread?: boolean
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<WorkItem['kind']>('implementation')
  const [priority, setPriority] = useState<WorkItem['priority']>('normal')
  const [repositories, setRepositories] = useState<number[]>([])
  const [startThread, setStartThread] = useState(false)
  const [createPr, setCreatePr] = useState(true)
  const [splitWorkItem, setSplitWorkItem] = useState(false)
  const [references, setReferences] = useState<WorkReferenceSelection[]>([])
  const [busy, setBusy] = useState(false)
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [resourceSelection, setResourceSelection] = useAgentResourceSelection()
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [backendId, setBackendId] = useState('')

  useEffect(() => {
    if (!open) return
    void loadBackendRegistry()
      .then(({ backends: available }) => {
        setBackends(available)
        setBackendId((current) => current || available.find((backend) => backend.isDefault)?.id || available[0]?.id || '')
      })
      .catch((error) => toast.error((error as Error).message))
  }, [open])

  useEffect(() => {
    if (!open) return
    const draft = readNewWorkDraft()
    const preferences = readWorkLaunchPreferences()
    const hasDraft = Boolean(draft.title || draft.description)
    setTitle(draft.title || '')
    setDescription(draft.description || '')
    setKind(draft.kind || 'implementation')
    setPriority(draft.priority || 'normal')
    setRepositories(suggestedWorkRepositories(data, draft.repositories, preferences.repositories))
    setStartThread(initialStartThread ?? (hasDraft && draft.startThread !== undefined ? draft.startThread : true))
    setCreatePr(draft.createPr ?? preferences.createPr)
    setSplitWorkItem(draft.splitWorkItem ?? preferences.splitWorkItem)
    setReferences([])
    setResourceSelection(null)
  }, [data.repositories, initialStartThread, open, setResourceSelection])

  useEffect(() => {
    if (!open) return
    writeNewWorkDraft({
      title,
      description,
      kind,
      priority,
      repositories,
      startThread,
      createPr,
      splitWorkItem,
    })
  }, [createPr, description, kind, open, priority, repositories, splitWorkItem, startThread, title])

  async function generateTitle() {
    setGeneratingTitle(true)
    try {
      const generatedTitle = await requestGeneratedWorkTitle(description, kind, backendId)
      setTitle(generatedTitle)
      toast.success('Outcome generated from your context')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setGeneratingTitle(false)
    }
  }

  async function finishCreatedItem(item: WorkItem, resolvedTitle: string, resources: ReturnType<typeof resourceSelectionPayload>) {
    try {
      const result = await launchCreatedWork(item, {
        startThread,
        repositories,
        description: description.trim() || resolvedTitle,
        createPr,
        splitWorkItem,
        resources,
      })
      notifyWorkCreated(item, result)
    } catch {
      notifyWorkLaunchRecovery(item)
    } finally {
      rememberWorkLaunchPreferences({ repositories, createPr, splitWorkItem })
      clearNewWorkDraft()
      onOpenChange(false)
      onCreated()
      void navigate({ to: '/work/$workKey', params: { workKey: item.key } })
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const resolvedTitle = title.trim() || (await requestGeneratedWorkTitle(description, kind, backendId))
      setTitle(resolvedTitle)
      const resources = resourceSelectionPayload(resourceSelection)
      const item = await backendApi<WorkItem>(backendId, '/api/work-items', {
        method: 'POST',
        body: JSON.stringify({
          title: resolvedTitle,
          description,
          kind,
          priority,
          repository_ids: repositories,
          references,
          split_work_item: splitWorkItem,
          ...resources,
        }),
      })
      await finishCreatedItem(item, resolvedTitle, resources)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return {
    title,
    setTitle,
    description,
    setDescription,
    kind,
    setKind,
    priority,
    setPriority,
    repositories,
    setRepositories,
    startThread,
    setStartThread,
    createPr,
    setCreatePr,
    splitWorkItem,
    setSplitWorkItem,
    references,
    setReferences,
    busy,
    generatingTitle,
    uploadingImages,
    setUploadingImages,
    resourceSelection,
    setResourceSelection,
    backends,
    backendId,
    setBackendId: (next: string) => {
      setBackendId(next)
      setReferences([])
      setResourceSelection(null)
      setRepositories((current) =>
        current.filter((repositoryId) => data.repositories.find((repository) => repository.id === repositoryId)?.backend_id === next),
      )
    },
    generateTitle,
    submit,
  }
}
