import { resilientFetch } from '@vertexade/platform-server/effect'

export type LinearClientConfig = { apiKey: string; teamIds: string[] }
export type LinearConfig = LinearClientConfig & { webhookSecret: string }
export type LinearIssueInput = {
  title?: string
  description?: string
  teamId?: string
  stateId?: string | null
  projectId?: string | null
  priority?: number
}

type GraphQlEnvelope<T> = { data?: T; errors?: Array<{ message?: string }> }
type LinearRecord = Record<string, any>

export function normalizeLinearConfig(
  input: Record<string, unknown> = {},
  current: LinearConfig = { apiKey: '', teamIds: [], webhookSecret: '' },
): LinearConfig {
  const rawTeams = input.team_ids ?? input.teamIds
  const teamIds =
    rawTeams === undefined
      ? current.teamIds
      : [
          ...new Set(
            (Array.isArray(rawTeams) ? rawTeams : [])
              .map(String)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ]
  return {
    apiKey: String(input.api_key || input.apiKey || '').trim() || current.apiKey,
    teamIds,
    webhookSecret: String(input.webhook_secret || input.webhookSecret || '').trim() || current.webhookSecret || '',
  }
}

export class LinearClient {
  constructor(
    private readonly config: LinearClientConfig,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  private async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await resilientFetch({
      service: 'Linear',
      fetch: this.fetchImpl,
      url: 'https://api.linear.app/graphql',
      init: {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: this.config.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    })
    let payload: GraphQlEnvelope<T>
    try {
      payload = (await response.json()) as GraphQlEnvelope<T>
    } catch {
      throw new Error(`Linear returned an invalid response (${response.status})`)
    }
    if (!response.ok) throw new Error(payload.errors?.[0]?.message || `Linear request failed (${response.status})`)
    if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message || 'Unknown GraphQL error').join(' · '))
    if (!payload.data) throw new Error('Linear returned no data')
    return payload.data
  }

  async teams() {
    const data = await this.request<{
      viewer: LinearRecord
      teams: { nodes: LinearRecord[] }
    }>(`query LinearTeams {
      viewer { id name email }
      teams(first: 100) { nodes { id key name description color } }
    }`)
    return { viewer: data.viewer, teams: data.teams.nodes }
  }

  async overview() {
    const data = await this.request<{
      viewer: LinearRecord
      teams: { nodes: LinearRecord[] }
      projects: { nodes: LinearRecord[] }
      workflowStates: { nodes: LinearRecord[] }
      issues: { nodes: LinearRecord[] }
    }>(`query LinearOverview {
      viewer { id name email }
      teams(first: 100) { nodes { id key name description color } }
      projects(first: 100, includeArchived: false) { nodes { id name url status { name type color } teams { nodes { id } } } }
      workflowStates(first: 100, includeArchived: false) { nodes { id name type color position team { id } } }
      issues(first: 250, includeArchived: false, orderBy: updatedAt) { nodes {
        id identifier title description priority estimate url branchName dueDate createdAt updatedAt
        team { id key name }
        state { id name type color }
        project { id name url }
        assignee { id name email }
        labels { nodes { id name color } }
      } }
    }`)
    const selected = new Set(this.config.teamIds)
    const teams = data.teams.nodes.filter((team) => selected.has(String(team.id)))
    const teamIds = new Set(teams.map((team) => String(team.id)))
    return {
      viewer: data.viewer,
      teams,
      projects: data.projects.nodes.filter((project) => project.teams?.nodes?.some((team: LinearRecord) => teamIds.has(String(team.id)))),
      states: data.workflowStates.nodes.filter((state) => teamIds.has(String(state.team?.id))),
      issues: data.issues.nodes.filter((issue) => teamIds.has(String(issue.team?.id))),
    }
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the WorkManagementProvider client contract.
  async issue(id: string) {
    const data = await this.request<{ issue: LinearRecord | null }>(
      `query LinearIssue($id: String!) {
      issue(id: $id) {
        id identifier title description priority estimate url branchName dueDate createdAt updatedAt
        team { id key name }
        state { id name type color }
        project { id name url }
        assignee { id name email }
        labels { nodes { id name color } }
      }
    }`,
      { id },
    )
    if (!data.issue || !this.config.teamIds.includes(String(data.issue.team?.id)))
      throw new Error('Linear issue was not found in a selected team')
    return data.issue
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the WorkManagementProvider client contract.
  async createIssue(input: Required<Pick<LinearIssueInput, 'title' | 'teamId'>> & LinearIssueInput) {
    const data = await this.request<{ issueCreate: { success: boolean; issue?: LinearRecord } }>(
      `mutation LinearIssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title url team { id } state { id name type color } project { id name url } } }
    }`,
      { input },
    )
    if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error('Linear did not create the issue')
    return data.issueCreate.issue
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the WorkManagementProvider client contract.
  async updateIssue(id: string, input: LinearIssueInput) {
    const data = await this.request<{ issueUpdate: { success: boolean; issue?: LinearRecord } }>(
      `mutation LinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id identifier title url priority state { id name type color } project { id name url } } }
    }`,
      { id, input },
    )
    if (!data.issueUpdate.success || !data.issueUpdate.issue) throw new Error('Linear did not update the issue')
    return data.issueUpdate.issue
  }
}
