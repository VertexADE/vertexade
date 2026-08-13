import { useMemo, useState } from 'react'
import { defaultMobileAgentOptions, type MobileAgentOptions } from '@/mobile-agent-options'
import type { MobileBackend } from '@/platform-service'
import {
  createMobileWorkItem,
  addMobileLocalFolder,
  addMobileRepository,
  startMobileThread,
  type MobileWorkItem,
  type MobileWorkspace,
  type MobileRepository,
  type MobileAgentResourceSelection,
} from '@/mobile-workspace-service'

export type MobileCreateMode = 'pullRequest' | 'work' | 'thread'

type CreationState = {
  backendId: string
  title: string
  prompt: string
  workItemId: number | null
  repositoryIds: number[]
  createPullRequest: boolean
  startAgent: boolean
  agentOptions: MobileAgentOptions
  resourceSelection: MobileAgentResourceSelection | null
  busy: boolean
  error: string
}

type CreationOptions = {
  mode: MobileCreateMode
  serviceUrl: string
  backends: MobileBackend[]
  workspace: MobileWorkspace
  initialWorkItem?: MobileWorkItem
  onCompleted(message: string): Promise<void>
}

export function useMobileWorkspaceCreation(options: CreationOptions) {
  const [state, setState] = useState<CreationState>(() => initialCreationState(options))
  const [addedRepositories, setAddedRepositories] = useState<MobileRepository[]>([])
  const selectedBackend = options.backends.find((backend) => backendKey(backend) === state.backendId) || null
  const repositories = useMemo(
    () => [...options.workspace.repositories, ...addedRepositories].filter((repository) => belongsToBackend(repository, selectedBackend)),
    [addedRepositories, options.workspace.repositories, selectedBackend],
  )
  const workItems = useMemo(
    () => options.workspace.workItems.filter((item) => belongsToBackend(item, selectedBackend) && !item.archived && item.state !== 'done'),
    [options.workspace.workItems, selectedBackend],
  )
  const selectedWorkItem = workItems.find((item) => item.id === state.workItemId) || null
  const selectedRepositories = repositories.filter((repository) => state.repositoryIds.includes(repository.id))
  const supportsPullRequests = selectedRepositories.length > 0 && selectedRepositories.every((repository) => repository.sourceKind === 'git')
  const valid = validCreation(options.mode, state, selectedWorkItem)

  function update(patch: Partial<CreationState>) {
    setState((current) => ({ ...current, ...patch }))
  }

  function chooseBackend(backendId: string) {
    update({
      backendId,
      workItemId: null,
      repositoryIds: [],
      agentOptions: defaultMobileAgentOptions(),
      resourceSelection: null,
      ...(options.mode === 'thread' ? { prompt: '' } : {}),
    })
  }

  function chooseWorkItem(item: MobileWorkItem) {
    update({
      workItemId: item.id,
      repositoryIds: item.repositoryIds?.length ? item.repositoryIds : item.primaryRepositoryId ? [item.primaryRepositoryId] : [],
      prompt: state.prompt.trim() || item.description || item.title,
      resourceSelection: null,
    })
  }

  async function submit() {
    if (!valid || state.busy) return
    update({ busy: true, error: '' })
    try {
      if (!selectedBackend) throw new Error('Choose a server')
      const message = await executeCreation(options.mode, { ...selectedBackend, serviceUrl: selectedBackend.serviceUrl || options.serviceUrl }, state, selectedWorkItem)
      await options.onCompleted(message)
      return
    } catch (reason) {
      update({ error: reason instanceof Error ? reason.message : 'Could not complete this creation request' })
      update({ busy: false })
    }
  }

  async function addRepository(repository: string) {
    if (!selectedBackend) throw new Error('Choose a server')
    update({ error: '' })
    try {
      const added = await addMobileRepository(selectedBackend.serviceUrl || options.serviceUrl, selectedBackend, repository)
      setAddedRepositories((current) => [...current.filter((candidate) => candidate.id !== added.id), added])
      update({ repositoryIds: [...new Set([...state.repositoryIds, added.id])] })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Repository could not be added'
      update({ error: message })
      throw reason
    }
  }

  async function addLocalFolder(input: { localPath: string; name?: string; workspaceStrategy: 'direct' | 'copy' | 'move' }) {
    if (!selectedBackend) throw new Error('Choose a server')
    update({ error: '' })
    try {
      const added = await addMobileLocalFolder(selectedBackend.serviceUrl || options.serviceUrl, selectedBackend, input)
      setAddedRepositories((current) => [...current.filter((candidate) => candidate.id !== added.id), added])
      update({ repositoryIds: [...new Set([...state.repositoryIds, added.id])] })
    } catch (reason) {
      update({ error: reason instanceof Error ? reason.message : 'Local folder could not be added' })
      throw reason
    }
  }

  return {
    ...state,
    repositories,
    workItems,
    selectedWorkItem,
    selectedRepositories,
    selectedBackend,
    supportsPullRequests,
    valid,
    setTitle: (title: string) => update({ title }),
    setPrompt: (prompt: string) => update({ prompt }),
    toggleRepository: (repositoryId: number) => {
      const repositoryIds = state.repositoryIds.includes(repositoryId)
        ? state.repositoryIds.filter((id) => id !== repositoryId)
        : [...state.repositoryIds, repositoryId].slice(0, 8)
      const selected = repositories.filter((repository) => repositoryIds.includes(repository.id))
      update({ repositoryIds, ...(!selected.length || selected.some((repository) => repository.sourceKind !== 'git') ? { createPullRequest: false } : {}) })
    },
    clearRepositories: () => update({ repositoryIds: [], createPullRequest: false }),
    setCreatePullRequest: (createPullRequest: boolean) => update({ createPullRequest }),
    setStartAgent: (startAgent: boolean) => update({ startAgent }),
    setAgentOptions: (agentOptions: MobileAgentOptions) => update({ agentOptions }),
    setResourceSelection: (resourceSelection: MobileAgentResourceSelection) => update({ resourceSelection }),
    chooseBackend,
    chooseWorkItem,
    addRepository,
    addLocalFolder,
    submit,
  }
}

function initialCreationState(options: CreationOptions): CreationState {
  return {
    backendId: initialBackendId(options),
    title: '',
    prompt: initialPrompt(options.initialWorkItem),
    workItemId: options.initialWorkItem?.id || null,
    repositoryIds: options.initialWorkItem?.repositoryIds?.length
      ? options.initialWorkItem.repositoryIds
      : options.initialWorkItem?.primaryRepositoryId ? [options.initialWorkItem.primaryRepositoryId] : [],
    createPullRequest: options.mode === 'pullRequest',
    startAgent: options.mode === 'pullRequest',
    agentOptions: defaultMobileAgentOptions(),
    resourceSelection: null,
    busy: false,
    error: '',
  }
}

function initialBackendId(options: CreationOptions): string {
  if (options.initialWorkItem) {
    const backend = options.backends.find((candidate) => belongsToBackend(options.initialWorkItem!, candidate))
    return backend ? backendKey(backend) : ''
  }
  const backend = options.backends[0]
  return backend ? backendKey(backend) : ''
}

function initialPrompt(item: MobileWorkItem | undefined): string {
  if (!item) return ''
  return item.description || item.title
}

function validCreation(mode: MobileCreateMode, state: CreationState, selectedWorkItem: MobileWorkItem | null): boolean {
  if (mode === 'work') return Boolean(state.title.trim() && state.backendId)
  if (mode === 'thread') return Boolean(selectedWorkItem && state.prompt.trim())
  return Boolean(state.title.trim() && state.repositoryIds.length && state.prompt.trim())
}

async function executeCreation(
  mode: MobileCreateMode,
  backend: MobileBackend,
  state: CreationState,
  selectedWorkItem: MobileWorkItem | null,
): Promise<string> {
  const serviceUrl = backend.serviceUrl || ''
  if (mode === 'thread') return startExistingWorkThread(serviceUrl, backend.id, state, selectedWorkItem)
  const item = await createMobileWorkItem(serviceUrl, {
    backendId: backend.id,
    title: state.title,
    description: state.prompt,
    ...(state.repositoryIds.length ? { repositoryIds: state.repositoryIds } : {}),
    ...(state.resourceSelection ? { resourceSelection: state.resourceSelection } : {}),
  })
  if (mode === 'work' && !state.startAgent) return `${item.key} added to Work.`
  if (mode === 'work') {
    const launchFailure = await workLaunchFailure(serviceUrl, backend.id, state, item)
    return launchFailure ? `${item.key} was created, but its agent could not start: ${launchFailure}. Retry from Work.` : `${item.key} created and its agent started.`
  }
  if (!state.repositoryIds.length) throw new Error(`${item.key} was created, but a repository is required to start its agent`)
  const launchFailure = await draftPullRequestLaunchFailure(serviceUrl, backend.id, state, item)
  if (launchFailure) return `${item.key} was created, but its draft PR thread could not start: ${launchFailure}. Retry from Work.`
  return `${item.key} created. Its agent will publish the draft PR when the work is ready.`
}

async function startExistingWorkThread(
  serviceUrl: string,
  backendId: string,
  state: CreationState,
  selectedWorkItem: MobileWorkItem | null,
): Promise<string> {
  if (!selectedWorkItem) throw new Error('Choose Work')
  await startMobileThread(serviceUrl, {
    backendId,
    workItemId: selectedWorkItem.id,
    ...(state.repositoryIds.length ? { repositoryIds: state.repositoryIds } : {}),
    prompt: state.prompt,
    createPullRequest: state.createPullRequest,
    agentOptions: state.agentOptions,
    ...(state.resourceSelection ? { resourceSelection: state.resourceSelection } : {}),
  })
  return `${selectedWorkItem.key} agent thread started${state.createPullRequest ? ' with draft PR delivery enabled' : ''}.`
}

async function workLaunchFailure(
  serviceUrl: string,
  backendId: string,
  state: CreationState,
  item: { id: number },
) {
  try {
    await startMobileThread(serviceUrl, {
      backendId,
      workItemId: item.id,
      ...(state.repositoryIds.length ? { repositoryIds: state.repositoryIds } : {}),
      prompt: state.prompt.trim() || state.title,
      createPullRequest: false,
      agentOptions: state.agentOptions,
      ...(state.resourceSelection ? { resourceSelection: state.resourceSelection } : {}),
    })
    return ''
  } catch (reason) {
    return reason instanceof Error ? reason.message : 'The agent could not start'
  }
}

async function draftPullRequestLaunchFailure(
  serviceUrl: string,
  backendId: string,
  state: CreationState,
  item: { id: number; key: string },
): Promise<string> {
  try {
    await startMobileThread(serviceUrl, {
      backendId,
      workItemId: item.id,
      repositoryIds: state.repositoryIds,
      prompt: state.prompt,
      createPullRequest: true,
      agentOptions: state.agentOptions,
      ...(state.resourceSelection ? { resourceSelection: state.resourceSelection } : {}),
    })
    return ''
  } catch (reason) {
    return reason instanceof Error ? reason.message : 'The agent could not start'
  }
}

function backendKey(backend: MobileBackend): string {
  return `${backend.serviceUrl || ''}::${backend.id}`
}

function belongsToBackend(item: { backendId: string; serviceUrl?: string }, backend: MobileBackend | null): boolean {
  return Boolean(backend && item.backendId === backend.id && (!item.serviceUrl || item.serviceUrl === backend.serviceUrl))
}
