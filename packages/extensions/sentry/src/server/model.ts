import {
  providerNumber as numberValue,
  providerRecord as sentryRecord,
  providerText as textValue,
  providerValues as values,
  type ProviderDataRecord,
} from '@vertexade/platform-server/provider-data'

export type SentryConfig = {
  url: string
  organization: string
  project: string
  token: string
}

export type SentryIssue = ProviderDataRecord

function nullableValue(value: unknown) {
  return value ?? null
}

function limitedRecord(value: unknown, limit = 16) {
  return Object.fromEntries(
    Object.entries(sentryRecord(value))
      .slice(0, limit)
      .map(([key, item]) => {
        if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
          return [key, item]
        }
        if (Array.isArray(item)) return [key, item.slice(0, 12)]
        return [key, Object.fromEntries(Object.entries(sentryRecord(item)).slice(0, 12))]
      }),
  )
}

function actor(value: unknown) {
  const item = sentryRecord(value)
  if (!Object.keys(item).length) return null
  const owner = sentryRecord(item.owner)
  return {
    id: textValue(item.id, owner.id),
    name: textValue(item.name, owner.name, item.email, owner.email),
    email: textValue(item.email, owner.email),
    type: textValue(item.type, owner.type),
  }
}

function eventEntry(event: SentryIssue, type: string) {
  return values(event.entries)
    .map(sentryRecord)
    .find((item) => item.type === type)
}

function eventUser(event: SentryIssue) {
  const user = sentryRecord(event.user)
  if (!Object.keys(user).length) return null
  return {
    id: String(user.id || ''),
    name: String(user.name || user.username || user.email || ''),
    email: String(user.email || ''),
    username: String(user.username || ''),
    ip_address: String(user.ip_address || ''),
  }
}

function eventRelease(event: SentryIssue) {
  const release = sentryRecord(event.release)
  if (!Object.keys(release).length) return null
  return {
    version: String(release.shortVersion || release.version || ''),
    ref: String(release.ref || ''),
    url: String(release.url || ''),
    date_created: String(release.dateCreated || ''),
    date_released: String(release.dateReleased || ''),
  }
}

function eventSdk(event: SentryIssue) {
  const sdk = sentryRecord(event.sdk)
  return Object.keys(sdk).length ? { name: String(sdk.name || ''), version: String(sdk.version || '') } : null
}

function eventException(event: SentryIssue) {
  const entry = sentryRecord(eventEntry(event, 'exception'))
  const exception = sentryRecord(values(entry.data?.values).at(-1))
  if (!Object.keys(exception).length) return null
  const mechanism = sentryRecord(exception.mechanism)
  const stacktrace = sentryRecord(exception.stacktrace)
  return {
    type: textValue(exception.type),
    value: textValue(exception.value),
    module: textValue(exception.module),
    handled: nullableValue(mechanism.handled),
    mechanism: textValue(mechanism.type),
    frames: values(stacktrace.frames).slice(-30).map(sentryRecord).map(exceptionFrame),
  }
}

function exceptionFrame(frame: SentryIssue) {
  return {
    filename: textValue(frame.filename, frame.absPath, frame.module),
    function: textValue(frame.function, '<unknown>'),
    module: textValue(frame.module),
    line: numberValue(frame.lineNo),
    column: numberValue(frame.colNo),
    in_app: Boolean(frame.inApp),
    context: values(frame.context)
      .slice(-9)
      .map((line) => {
        const tuple = values(line)
        return {
          line: numberValue(tuple[0]),
          code: textValue(tuple[1]),
        }
      }),
  }
}

function eventBreadcrumbs(event: SentryIssue) {
  const entry = sentryRecord(eventEntry(event, 'breadcrumbs'))
  return values(entry.data?.values)
    .slice(-25)
    .map(sentryRecord)
    .map((breadcrumb) => ({
      timestamp: String(breadcrumb.timestamp || ''),
      category: String(breadcrumb.category || ''),
      level: String(breadcrumb.level || ''),
      type: String(breadcrumb.type || ''),
      message: String(breadcrumb.message || ''),
      data: limitedRecord(breadcrumb.data, 10),
    }))
}

function eventRequest(event: SentryIssue) {
  const request = sentryRecord(sentryRecord(eventEntry(event, 'request')).data)
  if (!Object.keys(request).length) return null
  const headers = values(request.headers).map(values)
  const userAgent = headers.find((header) => String(header[0] || '').toLowerCase() === 'user-agent')
  return {
    method: String(request.method || ''),
    url: String(request.url || ''),
    query: values(request.query)
      .slice(0, 20)
      .map((pair) => {
        const tuple = values(pair)
        return [String(tuple[0] || ''), String(tuple[1] || '')]
      }),
    user_agent: String(userAgent?.[1] || ''),
  }
}

export function latestEventDetails(value: unknown) {
  const event = sentryRecord(value)
  if (!event.id && !event.eventID) {
    throw new Error('Sentry returned an invalid latest event response')
  }
  const tags = values(event.tags).map(sentryRecord)
  const environment = tags.find((tag) => tag.key === 'environment')?.value
  return {
    id: String(event.eventID || event.id),
    title: String(event.title || ''),
    message: String(event.message || event.metadata?.value || ''),
    type: String(event.type || ''),
    platform: String(event.platform || ''),
    date_created: String(event.dateCreated || ''),
    date_received: String(event.dateReceived || ''),
    environment: String(environment || ''),
    location: String(event.location || event.culprit || ''),
    size: Number(event.size || 0),
    user: eventUser(event),
    release: eventRelease(event),
    sdk: eventSdk(event),
    tags: tags
      .slice(0, 50)
      .map((tag) => ({
        key: String(tag.key || ''),
        value: String(tag.value || ''),
      }))
      .filter((tag) => tag.key),
    exception: eventException(event),
    breadcrumbs: eventBreadcrumbs(event),
    request: eventRequest(event),
    errors: values(event.errors)
      .slice(0, 12)
      .map(sentryRecord)
      .map((error) => ({
        type: String(error.type || ''),
        message: String(error.message || ''),
        data: limitedRecord(error.data, 10),
      })),
    contexts: Object.entries(sentryRecord(event.contexts))
      .slice(0, 16)
      .map(([name, context]) => ({
        name,
        values: limitedRecord(context, 14),
      })),
    metadata: limitedRecord(event.metadata, 20),
  }
}

export function sentryFinding(issue: SentryIssue, config: SentryConfig) {
  const project = issue.project?.slug || config.project
  return {
    id: String(issue.id),
    key: issue.shortId || String(issue.id),
    title: issue.title,
    message: issue.culprit || issue.metadata?.value || '',
    severity: issue.level || 'error',
    status: issue.status,
    count: Number(issue.count || 0),
    users: Number(issue.userCount || 0),
    first_seen: issue.firstSeen,
    last_seen: issue.lastSeen,
    project,
    link: issue.permalink || `${config.url}/organizations/${config.organization}/issues/${issue.id}/`,
  }
}

export function sentryFindingDetails(
  issue: SentryIssue,
  config: SentryConfig,
  latestEvent: ReturnType<typeof latestEventDetails> | null,
  latestEventError: string,
) {
  return {
    ...sentryFinding(issue, config),
    substatus: issue.substatus || '',
    priority: issue.priority || '',
    platform: issue.platform || issue.project?.platform || '',
    issue_type: issue.issueType || issue.type || '',
    issue_category: issue.issueCategory || '',
    comments: Number(issue.numComments || 0),
    user_reports: Number(issue.userReportCount || 0),
    assignee: actor(issue.assignedTo),
    owners: values(issue.owners).map(actor).filter(Boolean),
    participants: values(issue.participants).map(actor).filter(Boolean),
    first_release: issue.firstRelease?.shortVersion || issue.firstRelease?.version || '',
    last_release: issue.lastRelease?.shortVersion || issue.lastRelease?.version || '',
    tags: values(issue.tags)
      .map(sentryRecord)
      .map((tag) => ({
        key: String(tag.key || ''),
        name: String(tag.name || tag.key || ''),
        total_values: Number(tag.totalValues || 0),
      })),
    activity: values(issue.activity)
      .map(sentryRecord)
      .sort((left, right) => Date.parse(right.dateCreated || '') - Date.parse(left.dateCreated || ''))
      .slice(0, 30)
      .map((item) => ({
        id: String(item.id || ''),
        type: String(item.type || ''),
        date_created: String(item.dateCreated || ''),
        user: actor(item.user),
        data: limitedRecord(item.data, 12),
      })),
    metadata: limitedRecord(issue.metadata, 20),
    status_details: limitedRecord(issue.statusDetails, 20),
    annotations: values(issue.annotations).slice(0, 20),
    latest_event: latestEvent,
    latest_event_error: latestEventError,
  }
}
