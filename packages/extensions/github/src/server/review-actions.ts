import type { CapabilitySchema, ExtensionRegistrationContext, ScmProvider } from '@vertexade/platform-contracts'
import type { GitHubContext, PullRequestActionInput } from './types.ts'

const pullRequestActionSchema: CapabilitySchema = {
  type: 'object',
  required: ['repository', 'pull_number', 'head_sha'],
  additionalProperties: false,
  properties: {
    repository: { type: 'string', minLength: 3, maxLength: 300 },
    pull_number: { type: 'integer', minimum: 1 },
    head_sha: { type: 'string', minLength: 7, maxLength: 64 },
    comment: { type: 'string', maxLength: 65_536 },
  },
}

export function registerGitHubReviewActions(actions: ExtensionRegistrationContext['actions'], scm: ScmProvider, context: GitHubContext) {
  actions.register({
    id: 'github.approve',
    name: 'Approve pull request',
    inputSchema: pullRequestActionSchema,
    execute: async (raw) => approvePullRequest(scm, context, raw as PullRequestActionInput, false),
  })
  actions.register({
    id: 'github.approve-auto-merge',
    name: 'Approve and enable auto-merge',
    inputSchema: pullRequestActionSchema,
    execute: async (raw) => approvePullRequest(scm, context, raw as PullRequestActionInput, true),
  })
  actions.register({
    id: 'github.request-changes',
    name: 'Request pull-request changes',
    inputSchema: pullRequestActionSchema,
    execute: async (raw) => requestPullRequestChanges(scm, context, raw as PullRequestActionInput),
  })
  actions.register({
    id: 'github.comment-review',
    name: 'Comment on pull request',
    inputSchema: pullRequestActionSchema,
    execute: async (raw) => commentOnPullRequest(scm, context, raw as PullRequestActionInput),
  })
}

async function currentPullRequest(provider: ScmProvider, input: PullRequestActionInput) {
  const ref = { repository: input.repository, number: input.pull_number }
  const details = await provider.pullRequestDetails(ref, ['author', 'headRefOid', 'isDraft', 'state', 'statusCheckRollup'])
  if (String(details.state || 'OPEN').toUpperCase() !== 'OPEN') throw new Error('The pull request is no longer open')
  if (String(details.headRefOid || '') !== input.head_sha)
    throw new Error('The pull request changed; refresh before making a review decision')
  return { ref, details }
}

async function assertCanApprove(provider: ScmProvider, input: PullRequestActionInput) {
  const current = await currentPullRequest(provider, input)
  assertReadyForApproval(current.details)
  await assertNotAuthoredByViewer(provider, current.details.author?.login, 'You cannot approve your own pull request')
  assertPassingChecks(current.details.statusCheckRollup)
  return current.ref
}

function assertReadyForApproval(details: Awaited<ReturnType<ScmProvider['pullRequestDetails']>>) {
  if (details.isDraft) throw new Error('Draft pull requests cannot be approved')
}

async function assertNotAuthoredByViewer(provider: ScmProvider, author: string | undefined, message: string) {
  const viewer = await provider.currentUser()
  if (String(author || '').toLowerCase() === viewer.login.toLowerCase()) throw new Error(message)
}

function assertPassingChecks(value: unknown) {
  const checks = Array.isArray(value) ? value : []
  if (checks.some(failedCheck)) throw new Error('Resolve failing GitHub Actions before approval')
}

function failedCheck(check: Record<string, unknown>) {
  const conclusion = String(check.conclusion || '').toUpperCase()
  const state = String(check.state || '').toUpperCase()
  return failedConclusion(conclusion) || ['ERROR', 'FAILURE'].includes(state)
}

function failedConclusion(conclusion: string) {
  return Boolean(conclusion) && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)
}

async function approvePullRequest(scm: ScmProvider, context: GitHubContext, input: PullRequestActionInput, autoMerge: boolean) {
  const ref = await assertCanApprove(scm, input)
  await scm.approve(ref, optionalComment(input))
  if (autoMerge) await scm.enableAutoMerge(ref)
  emitReviewUpdate(context, 'pr_approved')
  return { ...actionIdentity(input), approved: true, ...(autoMerge ? { auto_merge: true } : {}) }
}

async function requestPullRequestChanges(scm: ScmProvider, context: GitHubContext, input: PullRequestActionInput) {
  const comment = requiredComment(input, 'Requesting changes requires a review comment')
  const current = await currentPullRequest(scm, input)
  assertReadyForReviewDecision(current.details)
  await assertNotAuthoredByViewer(scm, current.details.author?.login, 'You cannot request changes on your own pull request')
  if (!scm.requestChanges) throw new Error('This source-control provider cannot request changes')
  await scm.requestChanges(current.ref, comment)
  emitReviewUpdate(context, 'pr_review_submitted')
  return { ...actionIdentity(input), requested_changes: true }
}

function assertReadyForReviewDecision(details: Awaited<ReturnType<ScmProvider['pullRequestDetails']>>) {
  if (details.isDraft) throw new Error('Wait until the pull request is ready for review')
}

async function commentOnPullRequest(scm: ScmProvider, context: GitHubContext, input: PullRequestActionInput) {
  const comment = requiredComment(input, 'A review comment is required')
  const ref = await currentPullRequest(scm, input).then((value) => value.ref)
  await scm.postReviewComment(ref, comment)
  emitReviewUpdate(context, 'pr_review_submitted')
  return { ...actionIdentity(input), commented: true }
}

function requiredComment(input: PullRequestActionInput, message: string) {
  const comment = input.comment?.trim()
  if (!comment) throw new Error(message)
  return comment
}

function optionalComment(input: PullRequestActionInput) {
  return input.comment?.trim() || undefined
}

function actionIdentity(input: PullRequestActionInput) {
  return { repository: input.repository, pull_number: input.pull_number, head_sha: input.head_sha }
}

function emitReviewUpdate(context: GitHubContext, reason: string) {
  context.host.cache?.invalidate({ tags: ['pull-requests'] })
  context.host.events.emit(reason)
}
