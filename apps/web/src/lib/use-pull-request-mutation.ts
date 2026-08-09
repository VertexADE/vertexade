import { useRef, useState } from 'react'
import { toast } from 'sonner'

export type PullRequestMutationPhase = 'idle' | 'confirming' | 'submitting' | 'synchronizing' | 'succeeded' | 'failed' | 'retrying'

type PullRequestMutationState = {
  phase: PullRequestMutationPhase
  error: string | null
}

const idle: PullRequestMutationState = { phase: 'idle', error: null }

export function pullRequestMutationIsBusy(phase: PullRequestMutationPhase) {
  return phase === 'submitting' || phase === 'synchronizing' || phase === 'retrying'
}

export function useSingleSubmission() {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function run<T>(operation: () => Promise<T>) {
    if (lock.current) return undefined
    lock.current = true
    setBusy(true)
    try {
      return await operation()
    } catch (error) {
      toast.error((error as Error).message)
      return undefined
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}

export async function reconcilePullRequestChange(
  reconcile: () => Promise<void>,
  acceptedDescription: string,
  setError: (message: string | null) => void,
) {
  try {
    await reconcile()
    setError(null)
    return true
  } catch (error) {
    const message = `${acceptedDescription}, but the queue could not refresh: ${(error as Error).message}`
    setError(message)
    toast.error(message)
    return false
  }
}

export function usePullRequestMutation(reconcile: () => Promise<void>) {
  const [states, setStates] = useState<Record<string, PullRequestMutationState>>({})
  const locks = useRef(new Set<string>())
  const retries = useRef(new Map<string, () => Promise<void>>())

  function update(key: string, state: PullRequestMutationState) {
    setStates((current) => ({ ...current, [key]: state }))
  }

  async function synchronize(key: string, retrying = false) {
    update(key, { phase: retrying ? 'retrying' : 'synchronizing', error: null })
    try {
      await reconcile()
      retries.current.delete(key)
      update(key, { phase: 'succeeded', error: null })
    } catch (error) {
      const message = `The change was accepted, but the pull-request queue could not refresh: ${(error as Error).message}`
      retries.current.set(key, () => synchronize(key, true))
      update(key, { phase: 'failed', error: message })
      toast.error(message)
    }
  }

  async function run<T>(key: string, operation: () => Promise<T>, success: (result: T) => string) {
    if (locks.current.has(key)) return
    locks.current.add(key)
    update(key, { phase: 'submitting', error: null })
    try {
      const result = await operation()
      toast.success(success(result))
      retries.current.set(key, () => run(key, operation, success))
      await synchronize(key)
    } catch (error) {
      const message = (error as Error).message
      retries.current.set(key, () => run(key, operation, success))
      update(key, { phase: 'failed', error: message })
      toast.error(message)
    } finally {
      locks.current.delete(key)
    }
  }

  async function retry(key: string) {
    if (locks.current.has(key)) return
    const action = retries.current.get(key)
    if (!action) return
    await action()
  }

  const state = (key: string) => states[key] || idle
  const busy = (key: string) => pullRequestMutationIsBusy(state(key).phase)
  const failure = Object.entries(states)
    .reverse()
    .find(([, value]) => value.phase === 'failed' && value.error)

  return {
    busy,
    failure: failure ? { key: failure[0], message: failure[1].error! } : null,
    retry,
    run,
    state,
  }
}
