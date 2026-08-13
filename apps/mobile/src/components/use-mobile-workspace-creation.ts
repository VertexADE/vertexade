import { useMemo, useState } from 'react'
import { defaultMobileAgentOptions, type MobileAgentOptions } from '@/mobile-agent-options'
import type { MobileBackend } from '@/platform-service'
import {
  createMobileWorkItem,
  startMobileThread,
  type MobileWorkItem,
  type MobileWorkspace,
} from '@/mobile-workspace-service'

export type MobileCreateMode = 'pullRequest' | 'work' | 'thread'

type CreationState = {
  backendId: string
  title: string
  prompt: string
  workItemId: number | null
  repositoryId: number | null
  createPullRequest: boolean
  agentOptions: MobileAgentOptions
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
  const selectedBackend = options.backends.find((backend) => backendKey(backend) === state.backendId) || null
  const repositories = useMemo(
    () => options.workspace.repositories.filter((repository) => belongsToBackend(repository, selectedBackend)),
    [options.workspace.repositories, selectedBackend],
  )
  const workItems = useMemo(
    () => options.workspace.workItems.filter((item) => belongsToBackend(item, selectedBackend) && !item.archived && item.state !== 'done'),
    [options.workspace.workItems, selectedBackend],
  )
  const selectedWorkItem = workItems.find((item) => item.id === state.workItemId) || null
  const valid = validCreation(options.mode, state, selectedWorkItem)

  function update(patch: Partial<CreationState>) {
    setState((current) => ({ ...current, ...patch }))
  }

  function chooseBackend(backendId: string) {
    update({ backendId, workItemId: null, repositoryId: null, ...(options.mode === 'thread' ? { prompt: '' } : {}) })
  }

  function chooseWorkItem(item: MobileWorkItem) {
    update({
      workItemId: item.id,
      repositoryId: item.primaryRepositoryId,
      prompt: state.prompt.trim() || item.description || item.title,
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

  return {
    ...state,
    repositories,
    workItems,
    selectedWorkItem,
    selectedBackend,
    valid,
    setTitle: (title: string) => update({ title }),
    setPrompt: (prompt: string) => update({ prompt }),
    setRepositoryId: (repositoryId: number) => update({ repositoryId }),
    setCreatePullRequest: (createPullRequest: boolean) => update({ createPullRequest }),
    setAgentOptions: (agentOptions: MobileAgentOptions) => update({ agentOptions }),
    chooseBackend,
    chooseWorkItem,
    submit,
  }
}

function initialCreationState(options: CreationOptions): CreationState {
  return {
    backendId: initialBackendId(options),
    title: '',
    prompt: initialPrompt(options.initialWorkItem),
    workItemId: options.initialWorkItem?.id || null,
    repositoryId: options.initialWorkItem?.primaryRepositoryId || null,
    createPullRequest: options.mode === 'pullRequest',
    agentOptions: defaultMobileAgentOptions(),
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
  if (mode === 'thread') return Boolean(selectedWorkItem && state.repositoryId && state.prompt.trim())
  return Boolean(state.title.trim() && state.repositoryId && state.prompt.trim())
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
    ...(state.repositoryId ? { repositoryId: state.repositoryId } : {}),
  })
  if (mode === 'work') return `${item.key} added to Work.`
  if (!state.repositoryId) throw new Error(`${item.key} was created, but a repository is required to start its agent`)
  const launchFailure = await draftPullRequestLaunchFailure(serviceUrl, backend.id, { ...state, repositoryId: state.repositoryId }, item)
  if (launchFailure) return `${item.key} was created, but its draft PR thread could not start: ${launchFailure}. Retry from Work.`
  return `${item.key} created. Its agent will publish the draft PR when the work is ready.`
}

async function startExistingWorkThread(
  serviceUrl: string,
  backendId: string,
  state: CreationState,
  selectedWorkItem: MobileWorkItem | null,
): Promise<string> {
  if (!selectedWorkItem || !state.repositoryId) throw new Error('Choose Work and a repository')
  await startMobileThread(serviceUrl, {
    backendId,
    workItemId: selectedWorkItem.id,
    repositoryId: state.repositoryId,
    prompt: state.prompt,
    createPullRequest: state.createPullRequest,
    agentOptions: state.agentOptions,
  })
  return `${selectedWorkItem.key} agent thread started${state.createPullRequest ? ' with draft PR delivery enabled' : ''}.`
}

async function draftPullRequestLaunchFailure(
  serviceUrl: string,
  backendId: string,
  state: CreationState & { repositoryId: number },
  item: { id: number; key: string },
): Promise<string> {
  try {
    await startMobileThread(serviceUrl, {
      backendId,
      workItemId: item.id,
      repositoryId: state.repositoryId,
      prompt: state.prompt,
      createPullRequest: true,
      agentOptions: state.agentOptions,
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
