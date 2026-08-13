import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileServerCatalog } from '@/platform-service'
import {
  loadMobileWorkspace,
  type MobileWorkspace,
} from '@/mobile-workspace-service'

const emptyWorkspace: MobileWorkspace = {
  repositories: [],
  pullRequests: [],
  workItems: [],
  threads: [],
}

export type MobileConnectionCatalog = { serviceUrl: string; name?: string; servers: MobileServerCatalog[]; error?: string }

export function useMobileWorkspace(connections: MobileConnectionCatalog[], enabled = true) {
  const [workspace, setWorkspace] = useState<MobileWorkspace>(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [completedThread, setCompletedThread] = useState<MobileWorkspace['threads'][number] | null>(null)
  const requestSequence = useRef(0)
  const knownThreadStatuses = useRef<Map<string, string> | null>(null)
  const dismissCompletedThread = useCallback(() => setCompletedThread(null), [])
  const commitWorkspace = useCallback((sequence: number, result: { workspace: MobileWorkspace; warning: string }) => {
    if (requestSequence.current !== sequence) return
    setError(result.warning)
    const completed = newlyCompletedThread(knownThreadStatuses.current, result.workspace.threads)
    knownThreadStatuses.current = threadStatusMap(result.workspace.threads)
    if (completed) setCompletedThread(completed)
    setWorkspace(result.workspace)
  }, [])
  const commitError = useCallback((sequence: number, reason: unknown) => {
    if (requestSequence.current === sequence) setError(reason instanceof Error ? reason.message : 'Could not load the mobile workspace')
  }, [])
  const finishRefresh = useCallback((sequence: number, silent: boolean) => {
    if (requestSequence.current === sequence && !silent) setLoading(false)
  }, [])

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!enabled) return
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    if (!options?.silent) setLoading(true)
    setError('')
    try {
      const result = await loadUnifiedMobileWorkspace(connections)
      commitWorkspace(sequence, result)
    } catch (reason) {
      commitError(sequence, reason)
    } finally {
      finishRefresh(sequence, Boolean(options?.silent))
    }
  }, [commitError, commitWorkspace, connections, enabled, finishRefresh])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    return () => {
      requestSequence.current += 1
    }
  }, [refresh])

  const hasActiveThreads = workspace.threads.some((thread) => ['starting', 'running'].includes(thread.status))
  useEffect(() => {
    if (!enabled || !hasActiveThreads) return
    const timer = setInterval(() => void refresh({ silent: true }), 5_000)
    return () => clearInterval(timer)
  }, [enabled, hasActiveThreads, refresh])

  return {
    workspace,
    loading,
    error,
    notice,
    setNotice,
    completedThread,
    dismissCompletedThread,
    refresh,
  }
}

function threadIdentity(thread: MobileWorkspace['threads'][number]): string {
  return `${thread.serviceUrl || ''}:${thread.backendId}:${thread.id}`
}

function threadStatusMap(threads: MobileWorkspace['threads']): Map<string, string> {
  return new Map(threads.map((thread) => [threadIdentity(thread), thread.status]))
}

function newlyCompletedThread(previous: Map<string, string> | null, threads: MobileWorkspace['threads']): MobileWorkspace['threads'][number] | null {
  if (!previous) return null
  return threads
    .filter((thread) => thread.status === 'completed' && ['starting', 'running'].includes(previous.get(threadIdentity(thread)) || ''))
    .sort((left, right) => right.activityAt.localeCompare(left.activityAt))[0] || null
}

async function loadUnifiedMobileWorkspace(connections: MobileConnectionCatalog[]): Promise<{ workspace: MobileWorkspace; warning: string }> {
  const settled = await Promise.allSettled(connections
    .filter((connection) => !connection.error)
    .map(async (connection) => loadMobileWorkspace(connection.serviceUrl, connection.servers)))
  const workspaces = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failures = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  if (!workspaces.length && failures.length) throw failures[0]
  return { workspace: mergeMobileWorkspaces(workspaces), warning: workspaceFailureMessage(failures) }
}

function workspaceFailureMessage(failures: unknown[]): string {
  if (!failures.length) return ''
  const firstReason = failures[0]
  const message = firstReason instanceof Error ? firstReason.message : 'Could not load workspace'
  return `${failures.length} paired server${failures.length === 1 ? '' : 's'} unavailable: ${message}`
}

function mergeMobileWorkspaces(workspaces: MobileWorkspace[]): MobileWorkspace {
  return {
    repositories: workspaces.flatMap((workspace) => workspace.repositories),
    pullRequests: workspaces.flatMap((workspace) => workspace.pullRequests).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    workItems: workspaces.flatMap((workspace) => workspace.workItems).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    threads: workspaces.flatMap((workspace) => workspace.threads).sort((left, right) => right.activityAt.localeCompare(left.activityAt)),
  }
}
