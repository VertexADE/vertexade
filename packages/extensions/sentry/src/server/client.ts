import { parseJsonResponse } from '@vertexade/platform-server/http'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { guardedIntegrationFetch } from '@vertexade/platform-server/outbound-policy'
import { latestEventDetails, sentryFinding, sentryFindingDetails, type SentryConfig, type SentryIssue } from './model.ts'

export type { SentryConfig } from './model.ts'

export class SentryClient {
  config: SentryConfig
  fetch: typeof globalThis.fetch

  constructor(config: SentryConfig, fetchImpl = guardedIntegrationFetch) {
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, '') || 'https://sentry.io',
    }
    this.fetch = fetchImpl
  }

  fetchUrl(url: string | URL) {
    return resilientFetch({
      service: 'Sentry',
      fetch: this.fetch,
      url: url.toString(),
      init: {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
        },
      },
    })
  }

  async requestUrl(url: string) {
    const response = await this.fetchUrl(url)
    return parseJsonResponse(response, 'Sentry')
  }

  request(path: string) {
    return this.requestUrl(`${this.config.url}${path}`)
  }

  async findings(query = 'is:unresolved') {
    const params = new URLSearchParams({ query, statsPeriod: '14d' })
    if (this.config.project) params.append('project', this.config.project)
    const organization = encodeURIComponent(this.config.organization)
    let nextUrl: string | null = `${this.config.url}/api/0/organizations/${organization}/issues/?${params}`
    const issues: SentryIssue[] = []

    for (let page = 0; nextUrl && page < 100; page += 1) {
      const url: URL = new URL(nextUrl, this.config.url)
      if (url.origin !== new URL(this.config.url).origin) {
        throw new Error('Sentry returned an unsafe pagination URL')
      }
      const response = await this.fetchUrl(url)
      const values = await parseJsonResponse(response, 'Sentry')
      if (!Array.isArray(values)) {
        throw new Error('Sentry returned an invalid issues response')
      }
      issues.push(...values)
      const link: string = response.headers.get('link') || ''
      const next: string | undefined = link
        .split(',')
        .map((value: string) => value.trim())
        .find((value: string) => /rel="next"/.test(value) && !/results="false"/.test(value))
      nextUrl = next?.match(/^<([^>]+)>/)?.[1] || null
      if (page === 99 && nextUrl) {
        throw new Error('Sentry returned more than 100 pages of findings; narrow the query')
      }
    }

    return issues.map((issue) => sentryFinding(issue, this.config))
  }

  async findingDetails(issueId: string) {
    const organization = encodeURIComponent(this.config.organization)
    const encodedIssueId = encodeURIComponent(issueId)
    const basePath = `/api/0/organizations/${organization}/issues/${encodedIssueId}`
    const issue = (await this.request(`${basePath}/?expand=owners`)) as SentryIssue | null
    if (!issue || typeof issue !== 'object' || !issue.id) {
      throw new Error('Sentry returned an invalid issue response')
    }
    let latestEvent = null
    let latestEventError = ''

    try {
      latestEvent = latestEventDetails(await this.request(`${basePath}/events/latest/`))
    } catch (error) {
      latestEventError = (error as Error).message
    }

    return sentryFindingDetails(issue, this.config, latestEvent, latestEventError)
  }
}
