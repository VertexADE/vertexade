import { useEffect, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

type NewWorkValues = {
  title: string
  description: string
  kind: WorkItem['kind']
  priority: WorkItem['priority']
  repositories: number[]
  startThread: boolean
  createPr: boolean
  splitWorkItem: boolean
  references: WorkReferenceSelection[]
}

type CreateWorkMutation = {
  backendId: string
  body: Record<string, unknown>
}

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
  const queryClient = useQueryClient()
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [resourceSelection, setResourceSelection] = useAgentResourceSelection()
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [backendId, setBackendId] = useState('')
  const createWork = useMutation({
    mutationFn: ({ backendId: targetBackendId, body }: CreateWorkMutation) =>
      backendApi<WorkItem>(targetBackendId, '/api/work-items', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      kind: 'implementation',
      priority: 'normal',
      repositories: [],
      startThread: false,
      createPr: true,
      splitWorkItem: false,
      references: [],
    } as NewWorkValues,
    onSubmit: async ({ value }) => {
      try {
        const resolvedTitle = value.title.trim() || (await requestGeneratedWorkTitle(value.description, value.kind, backendId))
        form.setFieldValue('title', resolvedTitle)
        const resources = resourceSelectionPayload(resourceSelection)
        const item = await createWork.mutateAsync({
          backendId,
          body: {
            title: resolvedTitle,
            description: value.description,
            kind: value.kind,
            priority: value.priority,
            repository_ids: value.repositories,
            references: value.references,
            split_work_item: value.splitWorkItem,
            ...resources,
          },
        })
        await finishCreatedItem(item, resolvedTitle, resources, value)
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)
  const busy = useStore(form.store, (state) => state.isSubmitting)
  const { title, description, kind, priority, repositories, startThread, createPr, splitWorkItem, references } = formValues

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
    const suggestedRepositories = suggestedWorkRepositories(data, draft.repositories, preferences.repositories)
    const supportsPullRequests =
      suggestedRepositories.length > 0 &&
      suggestedRepositories.every((repositoryId) => repositorySupportsPullRequests(data.repositories, repositoryId))
    form.reset({
      title: draft.title || '',
      description: draft.description || '',
      kind: draft.kind || 'implementation',
      priority: draft.priority || 'normal',
      repositories: suggestedRepositories,
      startThread: initialStartThread ?? (hasDraft && draft.startThread !== undefined ? draft.startThread : true),
      createPr: supportsPullRequests && (draft.createPr ?? preferences.createPr),
      splitWorkItem: draft.splitWorkItem ?? preferences.splitWorkItem,
      references: [],
    })
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
      form.setFieldValue('title', generatedTitle)
      toast.success('Outcome generated from your context')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setGeneratingTitle(false)
    }
  }

  async function addRepository(repository: string) {
    return addRepositoryInput({ repository })
  }

  async function addLocalFolder(input: { local_path: string; name?: string; workspace_strategy: 'direct' | 'copy' }) {
    return addRepositoryInput(input)
  }

  async function addRepositoryInput(input: Record<string, unknown>) {
    const result = await backendApi<{ repo: WorkBoardData['repositories'][number] }>(backendId, '/api/repositories', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    form.setFieldValue('repositories', [...new Set([...form.getFieldValue('repositories'), result.repo.id])])
    await queryClient.invalidateQueries({ queryKey: ['platform'] })
    onCreated()
    toast.success(`Added ${result.repo.full_name}`)
    return result.repo.id
  }

  async function finishCreatedItem(
    item: WorkItem,
    resolvedTitle: string,
    resources: ReturnType<typeof resourceSelectionPayload>,
    value: NewWorkValues,
  ) {
    try {
      const result = await launchCreatedWork(item, {
        startThread: value.startThread,
        repositories: value.repositories,
        description: value.description.trim() || resolvedTitle,
        createPr: value.createPr,
        splitWorkItem: value.splitWorkItem,
        resources,
      })
      notifyWorkCreated(item, result)
    } catch {
      notifyWorkLaunchRecovery(item)
    } finally {
      rememberWorkLaunchPreferences({
        repositories: value.repositories,
        createPr: value.createPr,
        splitWorkItem: value.splitWorkItem,
      })
      clearNewWorkDraft()
      await queryClient.invalidateQueries({ queryKey: ['platform'] })
      onOpenChange(false)
      onCreated()
      void navigate({ to: '/work/$workKey', params: { workKey: item.key } })
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    void form.handleSubmit()
  }

  return {
    title,
    setTitle: (value: string) => form.setFieldValue('title', value),
    description,
    setDescription: (value: string) => form.setFieldValue('description', value),
    kind,
    setKind: (value: WorkItem['kind']) => form.setFieldValue('kind', value),
    priority,
    setPriority: (value: WorkItem['priority']) => form.setFieldValue('priority', value),
    repositories,
    setRepositories: (value: number[]) => {
      form.setFieldValue('repositories', value)
      const supportsPullRequests =
        value.length > 0 && value.every((repositoryId) => repositorySupportsPullRequests(data.repositories, repositoryId))
      if (!supportsPullRequests) form.setFieldValue('createPr', false)
    },
    startThread,
    setStartThread: (value: boolean) => form.setFieldValue('startThread', value),
    createPr,
    setCreatePr: (value: boolean) => form.setFieldValue('createPr', value),
    splitWorkItem,
    setSplitWorkItem: (value: boolean) => form.setFieldValue('splitWorkItem', value),
    references,
    setReferences: (value: WorkReferenceSelection[]) => form.setFieldValue('references', value),
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
      form.setFieldValue('references', [])
      setResourceSelection(null)
      form.setFieldValue(
        'repositories',
        form
          .getFieldValue('repositories')
          .filter((repositoryId) => data.repositories.find((repository) => repository.id === repositoryId)?.backend_id === next),
      )
    },
    generateTitle,
    addRepository,
    addLocalFolder,
    submit,
  }
}

function repositorySupportsPullRequests(repositories: WorkBoardData['repositories'], repositoryId: number) {
  const sourceKind = repositories.find((repository) => repository.id === repositoryId)?.source_kind
  return sourceKind !== 'directory' && sourceKind !== 'workspace'
}
