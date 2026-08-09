import { HttpRouter } from '@vertexade/platform-server/router'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { runApiEffect, timeoutApiPromise } from '@vertexade/platform-server/effect'
import { and, asc, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import {
  inboxTriageState,
  jobs,
  notifications as notificationsTable,
  pullRequests as pullRequestsTable,
  repositories as repositoriesTable,
  workItemResources,
  workItems,
  workResources,
} from '../database/schema/tables.ts'
import type { ExtensionRegistry } from '../extensions/registry.ts'
import type { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import type { InboxItem, InboxProvider, SearchProvider, SearchResult } from '@vertexade/platform-contracts'

type Dependencies = {
  database: DrizzleDashboardDatabase
  extensions: ExtensionRegistry
  executions: CapabilityExecutionService
}

function text(value: unknown) {
  return String(value || '').trim()
}

function includes(value: unknown, query: string) {
  return text(value).toLowerCase().includes(query)
}

function safeDestination(value: unknown, fallback: string) {
  const destination = text(value)
  return (destination.startsWith('/') && !destination.startsWith('//')) || destination.startsWith('https://') ? destination : fallback
}

export function createWorkspaceRoutes({ database, extensions, executions }: Dependencies) {
  const router = new HttpRouter()

  router.get('/api/inbox', async (request) => {
    const notifications = database
      .select({
        id: notificationsTable.id,
        kind: notificationsTable.kind,
        title: notificationsTable.title,
        message: notificationsTable.message,
        job_id: notificationsTable.jobId,
        automation_recipe_id: notificationsTable.automationRecipeId,
        read_at: notificationsTable.readAt,
        created_at: notificationsTable.createdAt,
        work_item_key: workItems.key,
      })
      .from(notificationsTable)
      .leftJoin(jobs, eq(jobs.id, notificationsTable.jobId))
      .leftJoin(workItems, eq(workItems.id, jobs.workItemId))
      .orderBy(desc(notificationsTable.id))
      .limit(100)
      .all()
      .map((item) => ({
        id: `notification:${item.id}`,
        type: 'notification',
        severity: text(item.kind).includes('failed') ? 'error' : 'info',
        title: item.title,
        summary: item.message,
        source: text(item.kind).replaceAll('_', ' '),
        createdAt: item.created_at,
        href: item.work_item_key
          ? `/work/${item.work_item_key}`
          : item.job_id
            ? `/threads?thread=${item.job_id}`
            : item.automation_recipe_id
              ? '/automations?tab=recipes'
              : null,
        actionLabel: item.work_item_key
          ? 'Open Work'
          : item.job_id
            ? 'Open thread'
            : item.automation_recipe_id
              ? 'Open automation'
              : undefined,
        unread: !item.read_at,
      }))
    const attention = database
      .select({
        key: workItems.key,
        title: workItems.title,
        attention: workItems.attention,
        updated_at: workItems.updatedAt,
      })
      .from(workItems)
      .where(and(sql`${workItems.archivedAt} IS NULL`, isNotNull(workItems.attention), sql`${workItems.attention} <> ''`))
      .orderBy(desc(workItems.updatedAt))
      .limit(100)
      .all()
      .map((item) => ({
        id: `work:${item.key}`,
        type: 'work',
        severity: 'warning',
        title: `${item.key} · ${item.title}`,
        summary: item.attention,
        source: 'Work item',
        createdAt: item.updated_at,
        href: `/work/${item.key}`,
        actionLabel: 'Open Work',
        unread: false,
      }))
    const pullRequests = database
      .select({
        repo_id: pullRequestsTable.repoId,
        number: pullRequestsTable.number,
        title: pullRequestsTable.title,
        checks_failed: pullRequestsTable.checksFailed,
        updated_at: pullRequestsTable.updatedAt,
        full_name: repositoriesTable.fullName,
      })
      .from(pullRequestsTable)
      .innerJoin(repositoriesTable, eq(repositoriesTable.id, pullRequestsTable.repoId))
      .where(gt(pullRequestsTable.checksFailed, 0))
      .orderBy(desc(pullRequestsTable.updatedAt))
      .limit(100)
      .all()
      .map((item) => ({
        id: `pr:${item.repo_id}:${item.number}`,
        type: 'pull-request',
        severity: 'error',
        title: `${item.full_name} #${item.number}`,
        summary: `${item.checks_failed} failing check${Number(item.checks_failed) === 1 ? '' : 's'} · ${item.title}`,
        source: 'Pull request',
        createdAt: item.updated_at,
        href: `/pull-requests?repo=${item.repo_id}&pr=${item.number}`,
        actionLabel: 'Open pull request',
        unread: false,
      }))
    const capabilities = executions
      .list(100)
      .filter((item) => ['failed', 'timed-out'].includes(item.status))
      .map((item) => ({
        id: `capability:${item.id}`,
        type: 'capability',
        severity: 'error',
        title: `${item.capabilityId} ${item.status}`,
        summary: item.error || 'Extension capability execution failed',
        source: item.moduleId,
        createdAt: item.updatedAt,
        href: '/automations?tab=runs&activity=history',
        actionLabel: 'Open run history',
        unread: false,
      }))
    const modules = extensions
      .catalog()
      .filter((module) => ['degraded', 'failed'].includes(module.lifecycle))
      .map((module) => ({
        id: `extension:${module.id}`,
        type: 'extension',
        severity: module.lifecycle === 'failed' ? 'error' : 'warning',
        title: `${module.name} needs attention`,
        summary: module.failure?.message || module.message || 'The extension reported degraded health',
        source: 'Extension',
        createdAt: module.checkedAt || '',
        href: `/extensions/${module.id}`,
        actionLabel: 'Check extension',
        unread: false,
      }))
    const providerResults = await Promise.all(
      extensions.providers
        .forKind<InboxProvider>('inbox')
        .available()
        .map(async (provider) => {
          try {
            const items = await runApiEffect(
              timeoutApiPromise(
                (signal) => provider.items({ moduleId: provider.moduleId, signal }),
                5_000,
                {
                  kind: 'upstream',
                  message: `${provider.name} inbox refresh failed`,
                  status: 502,
                  code: 'INBOX_PROVIDER_FAILED',
                },
                {
                  kind: 'upstream',
                  message: `${provider.name} inbox refresh timed out`,
                  status: 504,
                  code: 'INBOX_PROVIDER_TIMEOUT',
                },
              ),
              { signal: request.signal },
            )
            return { provider, items, failed: false }
          } catch {
            return { provider, items: [] as InboxItem[], failed: true }
          }
        }),
    )
    const extensionItems = providerResults.flatMap(({ provider, items: providerItems }): InboxItem[] => {
      const items = Array.isArray(providerItems) ? providerItems : []
      return items
        .slice(0, 100)
        .filter((item) => text(item.id) && text(item.title))
        .map((item) => ({
          ...item,
          id: `provider:${provider.moduleId}:${provider.id}:${text(item.id)}`,
          type: text(item.type) || 'extension',
          severity: ['info', 'warning', 'error'].includes(item.severity) ? item.severity : 'warning',
          title: text(item.title),
          summary: text(item.summary),
          source: text(item.source) || provider.name,
          createdAt: text(item.createdAt),
          href: safeDestination(item.href, `/extensions/${provider.moduleId}`),
          actionLabel: text(item.actionLabel) || 'Inspect',
          unread: Boolean(item.unread),
        }))
    })
    const providerFailures = providerResults
      .filter((result) => result.failed)
      .map(({ provider }) => ({
        id: `provider-health:${provider.moduleId}:${provider.id}`,
        type: 'extension',
        severity: 'warning',
        title: `${provider.name} could not refresh`,
        summary: 'This source did not respond, so its latest signals may be missing. Other Inbox sources remain available.',
        source: provider.name,
        createdAt: new Date().toISOString(),
        href: `/extensions/${provider.moduleId}`,
        actionLabel: 'Check extension',
        unread: false,
      }))
    const items = [
      ...notifications,
      ...attention,
      ...pullRequests,
      ...capabilities,
      ...modules,
      ...providerFailures,
      ...extensionItems,
    ].sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)))
    const triage = new Map(
      database
        .select({
          item_id: inboxTriageState.itemId,
          state: inboxTriageState.state,
          snoozed_until: inboxTriageState.snoozedUntil,
        })
        .from(inboxTriageState)
        .all()
        .map((item) => [text(item.item_id), item]),
    )
    const now = new Date().toISOString()
    const triagedItems = items.map((item) => {
      const saved = triage.get(item.id)
      const expired = saved?.state === 'snoozed' && text(saved.snoozed_until) <= now
      return {
        ...item,
        triageState: expired ? 'open' : text(saved?.state) || 'open',
        snoozedUntil: expired ? null : saved?.snoozed_until || null,
      }
    })
    return Response.json({
      items: triagedItems,
      summary: {
        total: triagedItems.filter((item) => item.triageState === 'open').length,
        errors: triagedItems.filter((item) => item.triageState === 'open' && item.severity === 'error').length,
        warnings: triagedItems.filter((item) => item.triageState === 'open' && item.severity === 'warning').length,
        unread: triagedItems.filter((item) => item.triageState === 'open' && item.unread).length,
      },
    })
  })

  router.patch('/api/inbox/:itemId', async (request, { params }) => {
    const input = await readJsonObject(request)
    const state = text(input.state)
    if (!['open', 'saved', 'snoozed', 'done'].includes(state)) throw new HttpError('Choose open, saved, snoozed, or done', 400)
    const snoozedUntil = state === 'snoozed' ? text(input.snoozedUntil) : ''
    if (state === 'snoozed' && (!snoozedUntil || Number.isNaN(Date.parse(snoozedUntil))))
      throw new HttpError('Choose when this item should return', 400)
    database
      .insert(inboxTriageState)
      .values({ itemId: params.itemId, state, snoozedUntil: snoozedUntil || null })
      .onConflictDoUpdate({
        target: inboxTriageState.itemId,
        set: { state, snoozedUntil: snoozedUntil || null, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .run()
    return Response.json({ itemId: params.itemId, state, snoozedUntil: snoozedUntil || null })
  })

  router.get('/api/search', async (request) => {
    const query = text(new URL(request.url).searchParams.get('q')).toLowerCase().slice(0, 100)
    if (query.length < 2) return Response.json({ results: [] })
    const work = database
      .select({ key: workItems.key, title: workItems.title, state: workItems.state, attention: workItems.attention })
      .from(workItems)
      .where(sql`${workItems.archivedAt} IS NULL`)
      .orderBy(desc(workItems.updatedAt))
      .limit(250)
      .all()
      .filter((item) => [item.key, item.title, item.state, item.attention].some((value) => includes(value, query)))
      .slice(0, 12)
      .map((item) => ({
        id: `work:${item.key}`,
        type: 'Work',
        title: `${item.key} · ${item.title}`,
        subtitle: item.attention || item.state,
        to: `/work/${item.key}`,
      }))
    const repositories = database
      .select({ id: repositoriesTable.id, full_name: repositoriesTable.fullName })
      .from(repositoriesTable)
      .orderBy(asc(sql`lower(${repositoriesTable.fullName})`))
      .all()
      .filter((item) => includes(item.full_name, query))
      .slice(0, 8)
      .map((item) => ({
        id: `repository:${item.id}`,
        type: 'Repository',
        title: item.full_name,
        subtitle: 'Open pull requests for this repository',
        to: `/pull-requests?repo=${item.id}`,
      }))
    const pullRequests = database
      .select({
        repo_id: pullRequestsTable.repoId,
        number: pullRequestsTable.number,
        title: pullRequestsTable.title,
        author: pullRequestsTable.author,
        full_name: repositoriesTable.fullName,
      })
      .from(pullRequestsTable)
      .innerJoin(repositoriesTable, eq(repositoriesTable.id, pullRequestsTable.repoId))
      .orderBy(desc(pullRequestsTable.updatedAt))
      .limit(250)
      .all()
      .filter((item) => [item.number, item.title, item.author, item.full_name].some((value) => includes(value, query)))
      .slice(0, 12)
      .map((item) => ({
        id: `pr:${item.repo_id}:${item.number}`,
        type: 'Pull request',
        title: `${item.full_name} #${item.number}`,
        subtitle: item.title,
        to: `/pull-requests?repo=${item.repo_id}&pr=${item.number}`,
      }))
    const threads = database
      .select({
        id: jobs.id,
        task_title: jobs.taskTitle,
        latest_activity: jobs.latestActivity,
        status: jobs.status,
        full_name: repositoriesTable.fullName,
      })
      .from(jobs)
      .innerJoin(repositoriesTable, eq(repositoriesTable.id, jobs.repoId))
      .orderBy(desc(jobs.id))
      .limit(250)
      .all()
      .filter((item) => [item.id, item.task_title, item.latest_activity, item.full_name].some((value) => includes(value, query)))
      .slice(0, 12)
      .map((item) => ({
        id: `run:${item.id}`,
        type: 'Run',
        title: item.task_title || `Run #${item.id}`,
        subtitle: `${item.full_name} · ${item.status}`,
        to: `/threads?thread=${item.id}`,
      }))
    const resources = database
      .select({
        id: workResources.id,
        kind: workResources.kind,
        label: workResources.label,
        provider: workResources.provider,
        key: workItems.key,
      })
      .from(workResources)
      .innerJoin(workItemResources, eq(workItemResources.resourceId, workResources.id))
      .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
      .orderBy(desc(workResources.updatedAt))
      .limit(250)
      .all()
      .filter((item) => [item.kind, item.label, item.provider, item.key].some((value) => includes(value, query)))
      .slice(0, 12)
      .map((item) => ({
        id: `resource:${item.id}:${item.key}`,
        type: text(item.kind).replaceAll('_', ' '),
        title: item.label,
        subtitle: `${item.provider} · ${item.key}`,
        to: `/work/${item.key}`,
      }))
    const commands = extensions
      .catalog()
      .filter((module) => module.enabled)
      .flatMap((module) => (module.ui?.commands || []).map((command) => ({ module, command })))
      .filter(({ module, command }) =>
        [module.name, command.label, command.description, ...(command.keywords || [])].some((value) => includes(value, query)),
      )
      .slice(0, 12)
      .map(({ module, command }) => ({
        id: `command:${module.id}:${command.id}`,
        type: 'Extension action',
        title: command.label,
        subtitle: command.description || module.name,
        to: command.to,
      }))
    const providerResults = await Promise.allSettled(
      extensions.providers
        .forKind<SearchProvider>('search')
        .available()
        .map(async (provider) => ({
          provider,
          results: await runApiEffect(
            timeoutApiPromise(
              (signal) =>
                provider.search(query, {
                  moduleId: provider.moduleId,
                  signal,
                }),
              2_000,
              {
                kind: 'upstream',
                message: `${provider.name} search failed`,
                status: 502,
                code: 'SEARCH_PROVIDER_FAILED',
              },
              {
                kind: 'upstream',
                message: `${provider.name} search timed out`,
                status: 504,
                code: 'SEARCH_PROVIDER_TIMEOUT',
              },
            ),
            { signal: request.signal },
          ),
        })),
    )
    const extensionResults = providerResults.flatMap((result): SearchResult[] => {
      if (result.status === 'rejected') return []
      const { provider } = result.value
      const results = Array.isArray(result.value.results) ? result.value.results : []
      return results
        .slice(0, 10)
        .filter((item) => text(item.id) && text(item.title) && text(item.to))
        .map((item) => ({
          id: `provider:${provider.moduleId}:${provider.id}:${text(item.id)}`,
          type: text(item.type) || provider.name,
          title: text(item.title),
          subtitle: text(item.subtitle) || provider.name,
          to: safeDestination(item.to, `/extensions/${provider.moduleId}`),
        }))
    })
    const coreResults = [...work, ...repositories, ...pullRequests, ...threads, ...resources, ...commands].slice(
      0,
      extensionResults.length ? 32 : 40,
    )
    return Response.json({ results: [...coreResults, ...extensionResults.slice(0, 8)] })
  })

  return router
}
