import { useCallback, useEffect, useState } from 'react'
import { defaultMobileAgentOptions, type MobileAgentOptions } from '@/mobile-agent-options'
import {
  cancelMobileQueuedMessage,
  deliverMobileThreadMessage,
  forkMobileThread,
  interruptMobileThread,
  loadMobileThreadDetails,
  postMobileReviewSuggestions,
  reReviewMobileThread,
  retryMobileThread,
  reorderMobileQueuedMessages,
  saveMobileThreadTasks,
  steerMobileQueuedMessage,
  submitMobileThreadInput,
  cancelMobileThreadInput,
  transferMobileThreadContext,
  type MobileForkThreadInput,
  type MobileReviewSuggestion,
  type MobileThreadDelivery,
} from '@/mobile-detail-service'
import { initialMobileThreadTab, type MobileThreadTab } from '@/mobile-thread-presentation'
import type { MobileThread } from '@/mobile-workspace-service'
import { confirmDestructive } from './confirm-destructive'
import { useMobileDetail } from './use-mobile-detail'

type ControllerOptions = {
  serviceUrl: string
  thread: MobileThread
  onChanged(message: string): Promise<void>
  onOpenThread?(thread: MobileThread): void
}

export function useMobileThreadController(options: ControllerOptions) {
  const model = useThreadModel(options.serviceUrl, options.thread)
  const mutation = useThreadMutationState(model.detail.refresh, options.onChanged)
  const actions = createThreadActions({ ...options, ...model, ...mutation })
  return { ...model, ...mutation, actions }
}

function useThreadModel(serviceUrl: string, thread: MobileThread) {
  const [tab, setTab] = useState<MobileThreadTab>('activity')
  const [message, setMessage] = useState('')
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [suggestions, setSuggestions] = useState<MobileReviewSuggestion[]>([])
  const [agentOptions, setAgentOptions] = useState<MobileAgentOptions>(defaultMobileAgentOptions)
  const loader = useCallback(() => loadMobileThreadDetails(serviceUrl, thread), [serviceUrl, thread])
  const detail = useMobileDetail(`thread:${thread.backendId}:${thread.id}`, loader)

  useEffect(() => {
    setAnswers({})
    setMessage('')
  }, [thread.backendId, thread.id])
  useEffect(() => {
    const value = detail.value
    if (!value) return
    setTab(initialMobileThreadTab(value))
    setAgentOptions({
      ...defaultMobileAgentOptions(value.agentId),
      model: value.model,
      reasoningEffort: value.reasoningEffort,
    })
  }, [detail.value?.id])
  useEffect(() => {
    if (detail.value) setSuggestions(detail.value.suggestions)
  }, [detail.value?.suggestions])
  useEffect(() => {
    if (!detail.value || !['starting', 'running'].includes(detail.value.status)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      await detail.refresh({ silent: true })
      if (!cancelled) timer = setTimeout(() => void poll(), 3_000)
    }
    timer = setTimeout(() => void poll(), 3_000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [detail.value?.status, detail.refresh])

  return {
    detail,
    tab,
    setTab,
    message,
    setMessage,
    answers,
    setAnswers,
    suggestions,
    setSuggestions,
    agentOptions,
    setAgentOptions,
  }
}

type ThreadMutationRunner = <Result>(action: () => Promise<Result>, success: string, onResult?: (result: Result) => void) => Promise<void>

function useThreadMutationState(refresh: () => Promise<void>, onChanged: (message: string) => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [queueBusyId, setQueueBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const run: ThreadMutationRunner = async (action, success, onResult) => {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      setNotice(success)
      await onChanged(success)
      await refresh()
      onResult?.(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this thread')
    } finally {
      setBusy(false)
    }
  }
  return {
    busy,
    queueBusyId,
    setQueueBusyId,
    notice,
    setNotice,
    error,
    setError,
    run,
  }
}

type ActionDependencies = ControllerOptions & ReturnType<typeof useThreadModel> & ReturnType<typeof useThreadMutationState>

function createThreadActions(dependencies: ActionDependencies) {
  return {
    send: (delivery: MobileThreadDelivery) => sendThreadMessage(dependencies, delivery),
    queued: (id: number, action: 'steer' | 'cancel') => void updateQueuedMessage(dependencies, id, action),
    reorderQueued: (ids: number[]) => void dependencies.run(() => reorderMobileQueuedMessages(dependencies.serviceUrl, dependencies.thread, ids), 'Queued messages reordered.'),
    interrupt: () => void confirmThreadInterrupt(dependencies),
    retry: () => void dependencies.run(() => retryMobileThread(dependencies.serviceUrl, dependencies.thread), 'Thread retry started.'),
    submitAnswers: () => void dependencies.run(() => submitMobileThreadInput(dependencies.serviceUrl, dependencies.thread, dependencies.answers), 'Answers submitted to the agent.'),
    cancelForm: () => void dependencies.run(() => cancelMobileThreadInput(dependencies.serviceUrl, dependencies.thread), 'Form cancelled.'),
    postSuggestions: () =>
      void dependencies.run(() => postMobileReviewSuggestions(dependencies.serviceUrl, dependencies.thread, dependencies.suggestions), 'Selected suggestions posted as one GitHub review.'),
    fork: (input: MobileForkThreadInput) =>
      void dependencies.run(
        () => forkMobileThread(dependencies.serviceUrl, dependencies.thread, input),
        dependencies.thread.repositorySourceKind === 'workspace'
          ? 'New isolated workspace and forked run started.'
          : 'New branch, worktree, and forked run started.',
        (forked) => dependencies.onOpenThread?.(forked),
      ),
    reReview: () =>
      void dependencies.run(
        () => reReviewMobileThread(dependencies.serviceUrl, dependencies.thread),
        'Fresh review started.',
        (threads) => threads[0] && dependencies.onOpenThread?.(threads[0]),
      ),
    saveTasks: () => void dependencies.run(() => saveMobileThreadTasks(dependencies.serviceUrl, dependencies.thread), 'Stack findings saved to the PR action list.'),
    transfer: (destination: number, title: string, instruction: string) =>
      void dependencies.run(() => transferMobileThreadContext(dependencies.serviceUrl, dependencies.thread, destination, title, instruction), 'Output sent to the destination worktree.'),
  }
}

function sendThreadMessage(dependencies: ActionDependencies, delivery: MobileThreadDelivery) {
  const success = {
    queue: 'Message queued for the next turn.',
    steer: 'The active turn was steered.',
    'follow-up': 'Follow-up sent.',
  }[delivery]
  void dependencies.run(
    () => deliverMobileThreadMessage(dependencies.serviceUrl, dependencies.thread, dependencies.message, delivery, dependencies.agentOptions),
    success,
    () => dependencies.setMessage(''),
  )
}

async function updateQueuedMessage(dependencies: ActionDependencies, id: number, action: 'steer' | 'cancel') {
  dependencies.setQueueBusyId(id)
  const success = action === 'steer' ? 'Queued message used to steer the active turn.' : 'Queued message removed.'
  const mutation =
    action === 'steer' ? () => steerMobileQueuedMessage(dependencies.serviceUrl, dependencies.thread, id) : () => cancelMobileQueuedMessage(dependencies.serviceUrl, dependencies.thread, id)
  await dependencies.run(mutation, success)
  dependencies.setQueueBusyId(null)
}

async function confirmThreadInterrupt(dependencies: ActionDependencies) {
  const confirmed = await confirmDestructive(`Interrupt thread #${dependencies.thread.id}?`, 'The active turn will stop gracefully. Its thread and worktree remain available.', 'Interrupt thread')
  if (confirmed) await dependencies.run(() => interruptMobileThread(dependencies.serviceUrl, dependencies.thread), 'Interrupt requested.')
}
