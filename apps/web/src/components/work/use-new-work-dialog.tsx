import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ScmRepositorySearchPage } from '@vertexade/platform-contracts'
import { useAgentResourceSelection, type AgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { WorkBoardData, WorkItem, WorkReferenceSelection } from '@vertexade/ui/lib/dashboard-types'
import {
  clearNewWorkDraft,
  launchCreatedWork,
  notifyWorkCreated,
  readNewWorkDraft,
  readWorkLaunchPreferences,
  rememberWorkLaunchPreferences,
  requestGeneratedWorkTitle,
  suggestedWorkRepositories,
  writeNewWorkDraft,
} from './new-work-service'
import {
  capableWorkBackends,
  mergeWorkRepositories,
  normalizeSelectedRepositoryIds,
  unifiedWorkRepositories,
  withDiscoveredWorkCapabilities,
  workLaunchPlans,
} from './work-targets'

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

async function compatibleResourceSelection(backendId: string, selection: AgentResourceSelection | null) {
  if (!selection) return {}
  const catalog = await backendApi<{
    skills: Array<{ id: string }>
    mcpServers: Array<{ id: string }>
  }>(backendId, '/api/agent-resources/selection')
  const skills = new Set(catalog.skills.map((item) => item.id))
  const mcpServers = new Set(catalog.mcpServers.map((item) => item.id))
  return {
    resource_selection: {
      skills: selection.skills.filter((id) => skills.has(id)),
      mcpServers: selection.mcpServers.filter((id) => mcpServers.has(id)),
    },
  }
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
  const [addedRepositories, setAddedRepositories] = useState<WorkBoardData['repositories']>([])
  const [targetBackendIds, setTargetBackendIds] = useState<string[]>([])
  const [discoveredCapabilities, setDiscoveredCapabilities] = useState<
    Array<{ identity: string; backendId: string; backendName: string; repository: string }>
  >([])
  const [discoveringCapabilities, setDiscoveringCapabilities] = useState(false)
  const initializedOpen = useRef(false)
  const allRepositories = useMemo(() => mergeWorkRepositories(data.repositories, addedRepositories), [addedRepositories, data.repositories])
  const registeredRepositories = useMemo(() => unifiedWorkRepositories(allRepositories, backends), [allRepositories, backends])
  const repositoriesByProject = useMemo(
    () => withDiscoveredWorkCapabilities(registeredRepositories, discoveredCapabilities),
    [discoveredCapabilities, registeredRepositories],
  )
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
      startThread: true,
      createPr: true,
      splitWorkItem: false,
      references: [],
    } as NewWorkValues,
    onSubmit: async ({ value }) => {
      try {
        const plans = workLaunchPlans(repositoriesByProject, value.repositories, targetBackendIds, backends)
        if (!plans.length) throw new Error('Choose at least one connected server that can access every selected project')
        const resolvedTitle = value.title.trim() || (await requestGeneratedWorkTitle(value.description, value.kind, plans[0]!.backend.id))
        form.setFieldValue('title', resolvedTitle)
        const outcomes = await Promise.allSettled(
          plans.map(async (plan) => {
            const resources = await compatibleResourceSelection(plan.backend.id, resourceSelection)
            const addedRepositories = await Promise.all(
              plan.repositoriesToAdd.map((repository) =>
                backendApi<{ repo: WorkBoardData['repositories'][number] }>(plan.backend.id, '/api/repositories', {
                  method: 'POST',
                  body: JSON.stringify({ repository }),
                }),
              ),
            )
            const resolvedPlan = {
              ...plan,
              repositoryIds: [...plan.repositoryIds, ...addedRepositories.map(({ repo }) => repo.id)],
              repositoriesToAdd: [],
            }
            const item = await createWork.mutateAsync({
              backendId: plan.backend.id,
              body: {
                title: resolvedTitle,
                description: value.description,
                kind: value.kind,
                priority: value.priority,
                repository_ids: resolvedPlan.repositoryIds,
                references: value.references,
                split_work_item: value.splitWorkItem,
                ...resources,
              },
            })
            return { item, plan: resolvedPlan, resources }
          }),
        )
        const created = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
        if (!created.length) throw new Error(outcomes.map((outcome) => (outcome.status === 'rejected' ? outcome.reason : '')).join(' · '))
        await finishCreatedItems(created, outcomes, resolvedTitle, value)
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)
  const busy = useStore(form.store, (state) => state.isSubmitting)
  const { title, description, kind, priority, repositories, startThread, createPr, splitWorkItem, references } = formValues
  const capableBackends = useMemo(
    () => capableWorkBackends(repositoriesByProject, repositories, backends),
    [backends, repositories, repositoriesByProject],
  )
  const primaryBackendId = targetBackendIds[0] || capableBackends[0]?.id || ''

  useEffect(() => {
    if (!open) {
      initializedOpen.current = false
      setAddedRepositories([])
      return
    }
    setDiscoveredCapabilities([])
    void loadBackendRegistry()
      .then(({ backends: available }) => {
        setBackends(available)
      })
      .catch((error) => toast.error((error as Error).message))
  }, [open])

  useEffect(() => {
    if (!open || !backends.length) return
    const controller = new AbortController()
    const probes = registeredRepositories
      .filter((repository) => repositories.includes(repository.id))
      .flatMap((repository) => {
        if (repository.source_kind !== 'git') return []
        const registered = new Set(repository.capabilities.map((capability) => capability.backendId))
        return backends
          .filter((backend) => !backend.connected || !registered.has(backend.id))
          .map(async (backend) => {
            const query = new URLSearchParams({ q: repository.full_name, limit: '20' })
            const page = await backendApi<ScmRepositorySearchPage>(backend.id, `/api/scm/repositories?${query}`, {
              signal: controller.signal,
            })
            const match = page.repositories.find(
              (candidate) => candidate.source === 'authenticated' && candidate.id.toLowerCase() === repository.full_name.toLowerCase(),
            )
            return {
              capability:
                match && !registered.has(backend.id)
                  ? {
                      identity: repository.identity,
                      backendId: backend.id,
                      backendName: backend.label,
                      repository: match.id,
                    }
                  : null,
              verifiedBackendId: match ? backend.id : null,
            }
          })
      })
    setDiscoveringCapabilities(Boolean(probes.length))
    void Promise.allSettled(probes).then((outcomes) => {
      if (controller.signal.aborted) return
      setDiscoveredCapabilities(
        outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' && outcome.value.capability ? [outcome.value.capability] : [])),
      )
      const verified = new Set(
        outcomes.flatMap((outcome) =>
          outcome.status === 'fulfilled' && outcome.value.verifiedBackendId ? [outcome.value.verifiedBackendId] : [],
        ),
      )
      if (verified.size)
        setBackends((current) => {
          let changed = false
          const next = current.map((backend) => {
            if (!verified.has(backend.id) || backend.connected) return backend
            changed = true
            return { ...backend, connected: true, error: null }
          })
          return changed ? next : current
        })
      setDiscoveringCapabilities(false)
    })
    return () => {
      controller.abort()
      setDiscoveringCapabilities(false)
    }
  }, [backends, open, registeredRepositories, repositories])

  useEffect(() => {
    if (!open || !backends.length || initializedOpen.current) return
    initializedOpen.current = true
    const draft = readNewWorkDraft()
    const preferences = readWorkLaunchPreferences()
    const suggestedRepositories = normalizeSelectedRepositoryIds(
      repositoriesByProject,
      suggestedWorkRepositories({ ...data, repositories: allRepositories }, draft.repositories, preferences.repositories),
    )
    const supportsPullRequests =
      suggestedRepositories.length > 0 &&
      suggestedRepositories.every((repositoryId) => repositorySupportsPullRequests(allRepositories, repositoryId))
    form.reset({
      title: draft.title || '',
      description: draft.description || '',
      kind: draft.kind || 'implementation',
      priority: draft.priority || 'normal',
      repositories: suggestedRepositories,
      startThread: initialStartThread ?? true,
      createPr: supportsPullRequests && (draft.createPr ?? preferences.createPr),
      splitWorkItem: draft.splitWorkItem ?? preferences.splitWorkItem,
      references: [],
    })
    setResourceSelection(null)
  }, [allRepositories, backends.length, data, initialStartThread, open, registeredRepositories, setResourceSelection])

  useEffect(() => {
    if (!open || !backends.length) return
    setTargetBackendIds((current) => {
      const capableIds = new Set(capableBackends.map((backend) => backend.id))
      const retained = current.filter((backendId) => capableIds.has(backendId))
      if (retained.length) return retained
      const preferred = capableBackends.find((backend) => backend.isDefault) || capableBackends[0]
      return preferred ? [preferred.id] : []
    })
  }, [capableBackends, open])

  useEffect(() => {
    if (!open || !backends.length) return
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
  }, [backends.length, createPr, description, kind, open, priority, repositories, splitWorkItem, startThread, title])

  async function generateTitle() {
    setGeneratingTitle(true)
    try {
      if (!primaryBackendId) throw new Error('Connect a server before generating a Work title')
      const generatedTitle = await requestGeneratedWorkTitle(description, kind, primaryBackendId)
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
    if (!primaryBackendId) {
      toast.error('Connect a server before adding a repository')
      return null
    }
    const result = await backendApi<{ repo: WorkBoardData['repositories'][number] }>(primaryBackendId, '/api/repositories', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    setAddedRepositories((current) => mergeWorkRepositories(current, [result.repo]))
    form.setFieldValue('repositories', [...new Set([...form.getFieldValue('repositories'), result.repo.id])])
    await queryClient.invalidateQueries({ queryKey: ['platform'] })
    onCreated()
    toast.success(`Added ${result.repo.full_name}`)
    return result.repo.id
  }

  async function finishCreatedItems(
    created: Array<{ item: WorkItem; plan: ReturnType<typeof workLaunchPlans>[number]; resources: object }>,
    creationOutcomes: PromiseSettledResult<{
      item: WorkItem
      plan: ReturnType<typeof workLaunchPlans>[number]
      resources: object
    }>[],
    resolvedTitle: string,
    value: NewWorkValues,
  ) {
    try {
      const launches = await Promise.allSettled(
        created.map(({ item, plan, resources }) =>
          launchCreatedWork(item, {
            startThread: value.startThread,
            repositories: plan.repositoryIds,
            description: value.description.trim() || resolvedTitle,
            createPr: value.createPr,
            splitWorkItem: value.splitWorkItem,
            resources,
          }),
        ),
      )
      const creationFailures = creationOutcomes.filter((outcome) => outcome.status === 'rejected').length
      const launchFailures = launches.filter(
        (outcome) => outcome.status === 'rejected' || (outcome.value && outcome.value.status !== 'started'),
      ).length
      if (!creationFailures && !launchFailures) {
        if (created.length === 1) notifyWorkCreated(created[0]!.item, launches[0]!.status === 'fulfilled' ? launches[0]!.value : null)
        else
          toast.success(
            value.startThread ? `Work created and started on ${created.length} servers` : `Work created on ${created.length} servers`,
          )
      } else {
        toast.warning(
          `Work initialized on ${created.length}/${creationOutcomes.length} servers; ${creationFailures + launchFailures} targets need attention`,
        )
      }
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
      void navigate({ to: '/work/$workKey', params: { workKey: created[0]!.item.key } })
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
        value.length > 0 && value.every((repositoryId) => repositorySupportsPullRequests(allRepositories, repositoryId))
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
    unifiedRepositories: repositoriesByProject,
    capableBackends,
    discoveringCapabilities,
    targetBackendIds,
    primaryBackendId,
    toggleTargetBackend: (backendId: string, selected: boolean) => {
      if (!selected && targetBackendIds.length === 1 && targetBackendIds[0] === backendId) return
      setTargetBackendIds((current) => {
        const next = selected ? [...new Set([...current, backendId])] : current.filter((candidate) => candidate !== backendId)
        return next.length ? next : current
      })
      form.setFieldValue('references', [])
      setResourceSelection(null)
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
