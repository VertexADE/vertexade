import type { ScmProvider, ScmPullRequestRef } from '@vertexade/platform-contracts'

type Run = (command: string, args: string[], options?: { input?: string; env?: Record<string, string | undefined> }) => Promise<string>
type TokenForRepository = (repository: string) => string | undefined

function refArgs(ref: ScmPullRequestRef) {
  return [String(ref.number), '--repo', ref.repository]
}

function parsePages(output: string) {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((page) => JSON.parse(page))
}

export function createGitHubScmProvider(run: Run, tokenForRepository: TokenForRepository = () => undefined): ScmProvider {
  const routedRun = (repository: string, args: string[], options: { input?: string } = {}) => {
    const token = tokenForRepository(repository)
    if (token) return run('gh', args, { ...options, env: { ...process.env, GH_TOKEN: token } })
    return options.input === undefined ? run('gh', args) : run('gh', args, options)
  }
  return {
    id: 'github',
    name: 'GitHub',
    presentation: {
      changeRequestLabel: 'pull request',
      changeRequestLabelPlural: 'pull requests',
    },
    parseRepository(input) {
      const cleaned = String(input || '')
        .trim()
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
      const match = cleaned.match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)$/)
      if (!match) throw new Error('Use owner/repository or a GitHub repository URL')
      const id = `${match[1]}/${match[2]}`
      return { id, webUrl: `https://github.com/${id}`, cloneUrl: `git@github.com:${id}.git` }
    },
    branchUrl(repository, branch) {
      return `https://github.com/${encodeURI(repository)}/tree/${encodeURIComponent(branch)}`
    },
    parsePullRequestUrl(url) {
      const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/)
      return match ? { repository: `${match[1]}/${match[2]}`, number: Number(match[3]) } : null
    },
    referencePresentation(repository) {
      return {
        providerName: 'GitHub',
        repositoryUrl: `https://github.com/${repository}`,
        issueUrlTemplate: `https://github.com/${repository}/issues/{number}`,
        userUrlTemplate: 'https://github.com/{user}',
        teamUrlTemplate: 'https://github.com/orgs/{organization}/teams/{team}',
      }
    },
    async currentUser() {
      const user = JSON.parse(await run('gh', ['api', 'user']))
      return { login: user.login, avatarUrl: user.avatar_url }
    },
    async listPullRequests(repository, state, limit, fields) {
      return JSON.parse(
        await routedRun(repository, [
          'pr',
          'list',
          '--repo',
          repository,
          '--state',
          state,
          '--limit',
          String(limit),
          '--json',
          fields.join(','),
        ]),
      )
    },
    async listOpenPullRequests(repository) {
      return parsePages(
        await routedRun(repository, [
          'api',
          '--method',
          'GET',
          '--paginate',
          `repos/${repository}/pulls`,
          '-f',
          'state=open',
          '-f',
          'per_page=100',
        ]),
      )
    },
    async pullRequestStatus(repository) {
      return JSON.parse(
        await routedRun(repository, [
          'pr',
          'list',
          '--repo',
          repository,
          '--state',
          'open',
          '--limit',
          '100',
          '--json',
          'number,mergeStateStatus,statusCheckRollup,comments,autoMergeRequest,reviewDecision',
        ]),
      )
    },
    async pullRequestDetails(ref, fields) {
      return JSON.parse(await routedRun(ref.repository, ['pr', 'view', ...refArgs(ref), '--json', fields.join(',')]))
    },
    pullRequestDiff(ref) {
      return routedRun(ref.repository, ['pr', 'diff', ...refArgs(ref)])
    },
    async reviewThreads(ref) {
      const [owner, name] = ref.repository.split('/')
      const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated viewerCanReply viewerCanResolve viewerCanUnresolve path line originalLine startLine originalStartLine diffSide comments(first:100){nodes{id databaseId body author{login}createdAt updatedAt url path line originalLine diffHunk}}}}}}}`
      return JSON.parse(
        await routedRun(ref.repository, [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
          '-F',
          `number=${ref.number}`,
        ]),
      )
    },
    async listLabels(repository) {
      return parsePages(
        await routedRun(repository, ['api', '--method', 'GET', '--paginate', `repos/${repository}/labels`, '-f', 'per_page=100']),
      )
    },
    async listCollaborators(repository) {
      return parsePages(
        await routedRun(repository, ['api', '--method', 'GET', '--paginate', `repos/${repository}/collaborators`, '-f', 'per_page=100']),
      )
    },
    async addLabel(ref, label) {
      return JSON.parse(
        await routedRun(ref.repository, [
          'api',
          '--method',
          'POST',
          `repos/${ref.repository}/issues/${ref.number}/labels`,
          '-f',
          `labels[]=${label}`,
        ]),
      )
    },
    async removeLabel(ref, label) {
      return JSON.parse(
        await routedRun(ref.repository, [
          'api',
          '--method',
          'DELETE',
          `repos/${ref.repository}/issues/${ref.number}/labels/${encodeURIComponent(label)}`,
        ]),
      )
    },
    async requestReviewers(ref, reviewers) {
      const args = ['api', '--method', 'POST', `repos/${ref.repository}/pulls/${ref.number}/requested_reviewers`]
      for (const login of reviewers) args.push('-f', `reviewers[]=${login}`)
      return JSON.parse(await routedRun(ref.repository, args))
    },
    async createPullRequest(input) {
      const args = [
        'pr',
        'create',
        '--repo',
        input.repository,
        '--head',
        input.head,
        '--base',
        input.base,
        '--title',
        input.title,
        '--body',
        input.body,
      ]
      if (input.draft) args.push('--draft')
      const url = (await routedRun(input.repository, args)).trim()
      return { url, draft: input.draft, head: input.head, base: input.base }
    },
    async approve(ref, comment) {
      const args = ['pr', 'review', ...refArgs(ref), '--approve']
      if (comment) args.push('--body', comment)
      await routedRun(ref.repository, args)
    },
    async requestChanges(ref, comment) {
      await routedRun(ref.repository, ['pr', 'review', ...refArgs(ref), '--request-changes', '--body', comment])
    },
    async enableAutoMerge(ref) {
      await routedRun(ref.repository, ['pr', 'merge', ...refArgs(ref), '--auto', '--squash'])
    },
    async updateBranch(ref, expectedHeadSha) {
      return JSON.parse(
        await routedRun(ref.repository, [
          'api',
          '--method',
          'PUT',
          `repos/${ref.repository}/pulls/${ref.number}/update-branch`,
          '-f',
          `expected_head_sha=${expectedHeadSha}`,
        ]),
      )
    },
    async markReady(ref) {
      await routedRun(ref.repository, ['pr', 'ready', ...refArgs(ref)])
    },
    async postReviewComment(ref, body) {
      await routedRun(ref.repository, ['pr', 'review', ...refArgs(ref), '--comment', '--body', body])
    },
    async postReviewSuggestions(ref, body, comments) {
      return JSON.parse(
        await routedRun(
          ref.repository,
          ['api', '--method', 'POST', `repos/${ref.repository}/pulls/${ref.number}/reviews`, '--input', '-'],
          {
            input: JSON.stringify({ event: 'COMMENT', body, comments }),
          },
        ),
      )
    },
    async postInlineComment(ref, comment) {
      return JSON.parse(
        await routedRun(
          ref.repository,
          ['api', '--method', 'POST', `repos/${ref.repository}/pulls/${ref.number}/comments`, '--input', '-'],
          {
            input: JSON.stringify({
              body: comment.body,
              commit_id: comment.commitId,
              path: comment.path,
              line: comment.line,
              side: comment.side,
              ...(comment.startLine ? { start_line: comment.startLine, start_side: comment.startSide || comment.side } : {}),
            }),
          },
        ),
      )
    },
    async replyToReviewComment(ref, commentId, body) {
      return JSON.parse(
        await routedRun(
          ref.repository,
          ['api', '--method', 'POST', `repos/${ref.repository}/pulls/${ref.number}/comments/${commentId}/replies`, '--input', '-'],
          {
            input: JSON.stringify({ body }),
          },
        ),
      )
    },
    async setReviewThreadResolved(_ref, threadId, resolved) {
      const action = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
      const query = `mutation($threadId:ID!){${action}(input:{threadId:$threadId}){thread{id isResolved}}}`
      return JSON.parse(await routedRun(_ref.repository, ['api', 'graphql', '-f', `query=${query}`, '-f', `threadId=${threadId}`]))
    },
  }
}
