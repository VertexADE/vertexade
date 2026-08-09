import type { Finding } from '@vertexade/platform-contracts'

export type CodeRabbitConfig = { repositoryIds: number[]; botLogins: string[] }
export type CodeRabbitRepository = { id: number; full_name: string }
type Run = (command: string, args: string[], options?: { input?: string }) => Promise<string>
type Value = Record<string, any>

export const defaultCodeRabbitConfig: CodeRabbitConfig = {
  repositoryIds: [],
  botLogins: ['coderabbitai'],
}

export function normalizeCodeRabbitConfig(
  input: Record<string, unknown>,
  current: CodeRabbitConfig = defaultCodeRabbitConfig,
): CodeRabbitConfig {
  const rawRepositories = input.repository_ids ?? input.repositoryIds
  const repositoryIds =
    rawRepositories === undefined
      ? current.repositoryIds
      : [
          ...new Set((Array.isArray(rawRepositories) ? rawRepositories : []).map(Number).filter((id) => Number.isInteger(id) && id > 0)),
        ].slice(0, 20)
  const rawBots = input.bot_logins ?? input.botLogins
  const botLogins =
    rawBots === undefined
      ? current.botLogins
      : [
          ...new Set(
            (Array.isArray(rawBots) ? rawBots : String(rawBots || '').split(','))
              .map((value) => normalizeLogin(String(value)))
              .filter(Boolean),
          ),
        ].slice(0, 10)
  return {
    repositoryIds,
    botLogins: botLogins.length ? botLogins : defaultCodeRabbitConfig.botLogins,
  }
}

function normalizeLogin(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\[bot\]$/, '')
}

function plainTitle(body: string) {
  const first =
    body
      .split('\n')
      .map((line) =>
        line
          .replace(/<[^>]+>/g, '')
          .replace(/^[#>*_`\s-]+/, '')
          .trim(),
      )
      .find(Boolean) || 'CodeRabbit review finding'
  return first.replace(/[*_`]/g, '').slice(0, 180)
}

function severity(body: string) {
  const value = body.toLowerCase()
  if (/critical|security vulnerability|data loss/.test(value)) return 'CRITICAL'
  if (/major|high severity|blocking/.test(value)) return 'HIGH'
  if (/nitpick|minor|optional|suggestion/.test(value)) return 'LOW'
  return 'MEDIUM'
}

function firstBotComment(thread: Value, bots: Set<string>) {
  const comments = Array.isArray(thread.comments?.nodes) ? thread.comments.nodes : []
  return comments.find((item: Value) => bots.has(normalizeLogin(String(item.author?.login || '')))) as Value | undefined
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function textValue(...values: unknown[]) {
  return String(firstValue(...values) ?? '')
}

function threadLine(thread: Value) {
  const value = Number(firstValue(thread.line, thread.originalLine, 0))
  return value > 0 ? value : null
}

function findingMessage(path: string, line: number | null, pull: Value) {
  if (!path) return textValue(pull.title)
  return line ? `${path}:${line}` : path
}

function findingTimestamps(comment: Value, pull: Value) {
  return {
    created_at: textValue(comment.createdAt),
    updated_at: textValue(comment.updatedAt, pull.updatedAt),
  }
}

function findingFromThread(repository: CodeRabbitRepository, pull: Value, thread: Value, bots: Set<string>): Finding | null {
  if (thread.isResolved) return null
  const comment = firstBotComment(thread, bots)
  if (!comment) return null
  const commentId = textValue(comment.databaseId, comment.id)
  const body = textValue(comment.body).trim()
  const path = textValue(thread.path)
  const line = threadLine(thread)
  return {
    id: `${repository.full_name}#${pull.number}:comment:${commentId}`,
    key: `${repository.full_name}#${pull.number}`,
    title: plainTitle(body),
    message: findingMessage(path, line, pull),
    severity: severity(body),
    status: thread.isOutdated ? 'outdated' : 'open',
    project: repository.full_name,
    link: textValue(comment.url, pull.url),
    repository: repository.full_name,
    repository_id: repository.id,
    pr_number: Number(pull.number),
    pr_title: textValue(pull.title),
    pr_url: textValue(pull.url),
    path,
    line,
    body,
    author: textValue(comment.author?.login),
    ...findingTimestamps(comment, pull),
  }
}

function findingsFromPull(repository: CodeRabbitRepository, pull: Value, bots: Set<string>): Finding[] {
  const threads = Array.isArray(pull.reviewThreads?.nodes) ? pull.reviewThreads.nodes : []
  const findings = threads.map((thread: Value) => findingFromThread(repository, pull, thread, bots)) as Array<Finding | null>
  return findings.filter((finding): finding is Finding => Boolean(finding))
}

const query = `query CodeRabbitFindings($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:50,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url updatedAt reviewThreads(first:100){nodes{isResolved isOutdated path line originalLine comments(first:100){nodes{id databaseId body url createdAt updatedAt author{login}}}}}}}}}`

export class CodeRabbitClient {
  constructor(
    private readonly run: Run,
    private readonly config: CodeRabbitConfig,
    private readonly repositories: CodeRabbitRepository[],
  ) {}

  selectedRepositories() {
    const selected = new Set(this.config.repositoryIds)
    return this.repositories.filter((repository) => selected.has(repository.id))
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the FindingsProvider contract.
  async verify() {
    const repositories = this.selectedRepositories()
    if (repositories.length !== this.config.repositoryIds.length) throw new Error('One or more selected repositories no longer exist')
    await Promise.all(repositories.map((repository) => this.run('gh', ['api', `repos/${repository.full_name}`, '--jq', '.full_name'])))
  }

  async findings(search = ''): Promise<Finding[]> {
    const results = await Promise.all(this.selectedRepositories().map((repository) => this.repositoryFindings(repository)))
    const needle = search.trim().toLowerCase()
    return results
      .flat()
      .filter(
        (finding) =>
          !needle || `${finding.key} ${finding.title} ${finding.message || ''} ${finding.project || ''}`.toLowerCase().includes(needle),
      )
  }

  private async repositoryFindings(repository: CodeRabbitRepository): Promise<Finding[]> {
    const [owner, name] = repository.full_name.split('/')
    if (!owner || !name) return []
    const response = JSON.parse(
      await this.run('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`]),
    ) as Value
    const pulls = response.data?.repository?.pullRequests?.nodes
    if (!Array.isArray(pulls)) throw new Error(`GitHub returned an invalid CodeRabbit review response for ${repository.full_name}`)
    const bots = new Set(this.config.botLogins.map(normalizeLogin))
    return pulls.flatMap((pull: Value) => findingsFromPull(repository, pull, bots))
  }

  async requestReview(repository: string, number: number, full = false) {
    const selected = this.selectedRepositories().find((item) => item.full_name === repository)
    if (!selected) throw new Error('Choose a configured repository')
    if (!Number.isInteger(number) || number < 1) throw new Error('Choose a valid pull request')
    return JSON.parse(
      await this.run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${repository}/issues/${number}/comments`,
        '-f',
        `body=@coderabbitai ${full ? 'full review' : 'review'}`,
      ]),
    ) as Value
  }
}
