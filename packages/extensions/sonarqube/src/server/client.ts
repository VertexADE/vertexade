import { parseJsonResponse } from '@vertexade/platform-server/http'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { guardedIntegrationFetch } from '@vertexade/platform-server/outbound-policy'
import { sonarFinding, sonarFindingDetails, sonarProject, sonarRecord, type SonarQubeConfig, type SonarValue } from './model.ts'

export type { SonarQubeConfig } from './model.ts'

export class SonarQubeClient {
  config: SonarQubeConfig
  fetch: typeof globalThis.fetch

  constructor(config: SonarQubeConfig, fetchImpl = guardedIntegrationFetch) {
    this.config = {
      ...config,
      projectKeys: [...new Set(config.projectKeys || [])],
      url: config.url.replace(/\/$/, ''),
    }
    this.fetch = fetchImpl
  }

  async requestUrl(url: string) {
    const response = await resilientFetch({
      service: 'SonarQube',
      fetch: this.fetch,
      url,
      init: {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
        },
      },
    })
    return parseJsonResponse(response, 'SonarQube')
  }

  request(path: string) {
    return this.requestUrl(`${this.config.url}${path}`)
  }

  async optional(path: string) {
    try {
      return { value: await this.request(path), error: '' }
    } catch (error) {
      return { value: null, error: (error as Error).message }
    }
  }

  async projects() {
    const server = new URL(this.config.url)
    const cloudApiHost =
      server.hostname === 'sonarcloud.io' ? 'api.sonarcloud.io' : server.hostname === 'sonarqube.us' ? 'api.sonarqube.us' : ''
    const organizations = cloudApiHost ? await this.requestUrl(`https://${cloudApiHost}/organizations/organizations`) : []
    if (cloudApiHost && !Array.isArray(organizations)) {
      throw new Error('SonarQube Cloud returned an invalid organizations response')
    }
    const organizationKeys = (organizations as SonarValue[]).map((organization) => String(organization.key || '')).filter(Boolean)
    const scopes = cloudApiHost ? organizationKeys : ['']
    const projects: ReturnType<typeof sonarProject>[] = []

    for (const organization of scopes) {
      let page = 1
      let loaded = 0
      let total = 0

      do {
        const params = new URLSearchParams({ ps: '500', p: String(page) })
        if (organization) params.set('organization', organization)
        else params.set('qualifiers', 'TRK')
        const result = sonarRecord(await this.request(`/api/components/search?${params}`))
        if (!Array.isArray(result.components)) {
          throw new Error('SonarQube returned an invalid projects response')
        }
        projects.push(...result.components.map(sonarProject).filter((project) => project.key))
        loaded += result.components.length
        total = Number(result.paging?.total || loaded)
        page += 1
        if (loaded < total && !result.components.length) {
          throw new Error('SonarQube project pagination stopped before all projects were returned')
        }
      } while (loaded < total)
    }

    return [...new Map(projects.map((project) => [project.key, project])).values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
  }

  async findings() {
    const issues: SonarValue[] = []
    const chunks = Array.from({ length: Math.ceil(this.config.projectKeys.length / 50) }, (_, index) =>
      this.config.projectKeys.slice(index * 50, (index + 1) * 50),
    )

    for (const projectKeys of chunks) {
      let page = 1
      let total = 0
      let loaded = 0

      do {
        const params = new URLSearchParams({
          componentKeys: projectKeys.join(','),
          resolved: 'false',
          ps: '500',
          p: String(page),
          s: 'SEVERITY',
          asc: 'false',
          additionalFields: '_all',
        })
        const result = sonarRecord(await this.request(`/api/issues/search?${params}`))
        if (!Array.isArray(result.issues)) {
          throw new Error('SonarQube returned an invalid issues response')
        }
        issues.push(...result.issues)
        total = Number(result.paging?.total || result.total || result.issues.length)
        loaded += result.issues.length
        if (loaded < total && !result.issues.length) {
          throw new Error('SonarQube issue pagination stopped before all findings were returned')
        }
        page += 1
        if (loaded < total && page > 20) {
          throw new Error(
            `SonarQube has ${total} unresolved findings for the selected project group, exceeding its 10,000-result API window; select fewer projects`,
          )
        }
      } while (loaded < total)
    }

    return [...new Map(issues.map((issue) => [String(issue.key), issue])).values()].map((issue) => sonarFinding(issue, this.config))
  }

  async findingDetails(issueId: string) {
    const search = new URLSearchParams({
      issues: issueId,
      ps: '1',
      additionalFields: '_all',
    })
    const result = sonarRecord(await this.request(`/api/issues/search?${search}`))
    const issue = sonarRecord(Array.isArray(result.issues) ? result.issues[0] : null)
    if (!issue.key) throw new Error('SonarQube issue was not found')
    const component = findComponent(result.components, issue.component)
    const projectComponent = findComponent(result.components, issue.project)
    const [ruleResult, changelogResult, sourceResult] = await Promise.all([
      optionalRule(this, issue),
      optionalChangelog(this, issueId),
      optionalSource(this, issue),
    ])

    return sonarFindingDetails({
      issue,
      component,
      projectComponent,
      rule: sonarRecord(sonarRecord(ruleResult.value).rule),
      changelog: sonarRecord(changelogResult.value),
      source: sonarRecord(sourceResult.value),
      detailErrors: [ruleResult.error, changelogResult.error, sourceResult.error],
      config: this.config,
    })
  }
}

function findComponent(value: unknown, key: unknown) {
  const components: SonarValue[] = Array.isArray(value) ? value : []
  return components.find((item) => item.key === key) ?? {}
}

function emptyOptionalResult() {
  return Promise.resolve({ value: null, error: '' })
}

function optionalRule(client: SonarQubeClient, issue: SonarValue) {
  const ruleKey = String(issue.rule || '')
  if (!ruleKey) return emptyOptionalResult()
  const params = new URLSearchParams({ key: ruleKey })
  if (issue.organization) {
    params.set('organization', String(issue.organization))
  }
  return client.optional(`/api/rules/show?${params}`)
}

function optionalChangelog(client: SonarQubeClient, issueId: string) {
  const params = new URLSearchParams({ issue: issueId })
  return client.optional(`/api/issues/changelog?${params}`)
}

function optionalSource(client: SonarQubeClient, issue: SonarValue) {
  const line = Number(issue.line || issue.textRange?.startLine || 0)
  if (!issue.component || !line) return emptyOptionalResult()
  const params = new URLSearchParams({
    key: String(issue.component),
    from: String(Math.max(1, line - 5)),
    to: String(line + 5),
  })
  return client.optional(`/api/sources/lines?${params}`)
}
