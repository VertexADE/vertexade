import {
  PLATFORM_API_VERSION,
  type ContextualActionCondition,
  type DashboardExtension,
  type TriggerCapability,
} from '@vertexade/platform-contracts'
import { githubSettings } from '../shared/settings.ts'

const approvalConditions: ContextualActionCondition[] = [
  {
    field: 'draft',
    operator: 'equals',
    value: 0,
    disabledReason: 'Draft pull requests cannot be approved',
  },
  {
    field: 'authored_by_me',
    operator: 'equals',
    value: false,
    disabledReason: 'You cannot approve your own pull request',
  },
  {
    field: 'checks_failed',
    operator: 'equals',
    value: 0,
    disabledReason: 'Resolve failing GitHub Actions before approval',
  },
]

const reviewDecisionConditions: ContextualActionCondition[] = [
  {
    field: 'draft',
    operator: 'equals',
    value: 0,
    disabledReason: 'Wait until the pull request is ready for review',
  },
  {
    field: 'authored_by_me',
    operator: 'equals',
    value: false,
    disabledReason: 'You cannot request changes on your own pull request',
  },
]

export function createGitHubManifest(refreshTrigger: TriggerCapability): DashboardExtension['manifest'] {
  return {
    id: 'github',
    name: 'GitHub',
    version: '0.0.1',
    platformApi: PLATFORM_API_VERSION,
    kind: 'source-control',
    description: 'Source control, pull requests, reviews, checks, and merge automation.',
    catalog: {
      tagline: 'Pull requests, reviews, checks, and merge automation',
      category: 'source-control',
      publisher: { name: 'VertexADE', url: 'https://github.com' },
      icon: { asset: 'assets/icon.svg' },
      accent: 'slate',
      tags: ['SCM', 'Pull requests', 'Reviews'],
      featured: true,
      highlights: ['GitHub App authentication', 'Pull-request review workflows', 'GitHub Actions deployment tracking'],
      links: { homepage: 'https://github.com', documentation: 'https://docs.github.com' },
    },
    portable: { surfaces: [], settings: githubSettings },
    permissions: ['settings.read', 'settings.write', 'scm-auth.manage', 'process.execute', 'events.emit', 'cache.read', 'cache.write'],
    setupChecks: [
      {
        id: 'github-cli',
        name: 'GitHub CLI',
        command: 'gh',
        args: ['--version'],
        install: 'Install from https://cli.github.com',
      },
      {
        id: 'github-auth',
        name: 'GitHub authentication',
        command: 'gh',
        args: ['auth', 'status', '--active'],
        install: 'Run gh auth login, or configure a GitHub App in this extension',
      },
    ],
    contributes: {
      actions: [
        {
          id: 'github.approve',
          name: 'Approve pull request',
          description: 'Approve the current pull-request head after revalidating it',
        },
        {
          id: 'github.approve-auto-merge',
          name: 'Approve and enable auto-merge',
          description: 'Approve the current head and enable squash auto-merge',
        },
        {
          id: 'github.request-changes',
          name: 'Request pull-request changes',
          description: 'Submit a changes-requested review for the current head',
        },
        {
          id: 'github.comment-review',
          name: 'Comment on pull request',
          description: 'Submit a comment-only pull-request review',
        },
      ],
      triggers: [refreshTrigger],
    },
    ui: {
      notifications: [
        {
          kind: 'review_started',
          label: 'Pull-request review started',
          severity: 'info',
          actionLabel: 'Open pull requests',
          to: '/pull-requests',
        },
        {
          kind: 'review_posted',
          label: 'Pull-request review posted',
          severity: 'success',
          actionLabel: 'Open pull requests',
          to: '/pull-requests',
        },
        {
          kind: 'pr_review_submitted',
          label: 'Pull-request review submitted',
          severity: 'success',
          actionLabel: 'Open pull requests',
          to: '/pull-requests',
        },
      ],
      automationTemplates: [
        {
          id: 'assigned-pr-review',
          name: 'Review assigned PRs',
          description: 'Start a private review whenever a pull request is assigned to a chosen GitHub username.',
          triggerId: 'core.pull-request-reviewers-changed',
          conditionMode: 'all',
          conditions: [{ field: 'data.entity.reviewer_logins', operator: 'contains' }],
          threadAction: 'review',
          promptSteps: [
            {
              name: 'Review',
              prompt:
                'Review the assigned pull request for correctness, maintainability, security, tests, and user-facing regressions. Prioritize concrete findings and explain the safest next action.',
            },
          ],
        },
        {
          id: 'assigned-pr-improve',
          name: 'Review and fix assigned PRs',
          description: 'Review an assigned PR, request approval for a concrete plan, then fix only approved items.',
          triggerId: 'core.pull-request-reviewers-changed',
          conditionMode: 'all',
          conditions: [{ field: 'data.entity.reviewer_logins', operator: 'contains' }],
          threadAction: 'improve',
          promptSteps: [
            {
              name: 'Review and plan',
              prompt:
                'Review the assigned pull request deeply. Propose independent, evidence-backed fixes for correctness, maintainability, security, tests, and user-facing regressions.',
            },
          ],
        },
      ],
      contextualActions: [
        {
          id: 'github.approve-pr',
          capabilityId: 'github.approve',
          label: 'Approve',
          description: 'Approve the current pull-request head',
          placements: ['pull-request.review', 'pull-request.review-result', 'pull-request.menu'],
          entityKinds: ['pull-request'],
          tone: 'positive',
          inputMapping: { repository: 'full_name', pull_number: 'number', head_sha: 'head_sha' },
          inputFields: [
            {
              name: 'comment',
              label: 'Review comment',
              type: 'textarea',
              required: false,
              maxLength: 65_536,
              placeholder: 'Add context for the author (optional)…',
              description: 'Optional. Add context without creating a separate review step.',
            },
          ],
          conditions: approvalConditions,
          confirmation: {
            level: 'confirm',
            title: 'Approve this pull request?',
            description: 'GitHub will receive an approval for the currently displayed head SHA.',
            confirmLabel: 'Approve',
          },
          successMessage: 'Pull request approved',
          invalidates: ['pull-request', 'work'],
        },
        {
          id: 'github.approve-auto-merge-pr',
          capabilityId: 'github.approve-auto-merge',
          label: 'Approve & auto-merge',
          description: 'Approve and enable squash auto-merge after required checks',
          placements: ['pull-request.secondary', 'pull-request.review-result', 'pull-request.menu'],
          entityKinds: ['pull-request'],
          inputMapping: { repository: 'full_name', pull_number: 'number', head_sha: 'head_sha' },
          conditions: approvalConditions,
          confirmation: {
            level: 'confirm',
            title: 'Approve and enable auto-merge?',
            description: 'Approval is submitted first. Squash auto-merge is enabled only if approval succeeds.',
            confirmLabel: 'Approve & auto-merge',
          },
          successMessage: 'Pull request approved and auto-merge enabled',
          invalidates: ['pull-request', 'work'],
        },
        {
          id: 'github.request-pr-changes',
          capabilityId: 'github.request-changes',
          label: 'Request changes',
          description: 'Submit an editable changes-requested review',
          placements: ['pull-request.review', 'pull-request.review-result', 'pull-request.menu'],
          entityKinds: ['pull-request'],
          tone: 'warning',
          inputMapping: { repository: 'full_name', pull_number: 'number', head_sha: 'head_sha' },
          inputFields: [
            {
              name: 'comment',
              label: 'Required changes',
              type: 'textarea',
              required: true,
              maxLength: 65_536,
              placeholder: 'Explain the changes required before approval…',
            },
          ],
          conditions: reviewDecisionConditions,
          confirmation: {
            level: 'confirm',
            title: 'Request these changes?',
            description: 'A changes-requested review will be submitted to GitHub.',
            confirmLabel: 'Request changes',
          },
          successMessage: 'Changes requested',
          invalidates: ['pull-request', 'work'],
        },
        {
          id: 'github.comment-on-pr-review',
          capabilityId: 'github.comment-review',
          label: 'Comment only',
          description: 'Submit review feedback without an approval decision',
          placements: ['pull-request.review', 'pull-request.review-result', 'pull-request.menu'],
          entityKinds: ['pull-request'],
          inputMapping: { repository: 'full_name', pull_number: 'number', head_sha: 'head_sha' },
          inputFields: [
            {
              name: 'comment',
              label: 'Review comment',
              type: 'textarea',
              required: true,
              maxLength: 65_536,
              placeholder: 'Write review feedback…',
            },
          ],
          confirmation: {
            level: 'confirm',
            title: 'Post this review comment?',
            description: 'The comment will be submitted without approving or requesting changes.',
            confirmLabel: 'Post comment',
          },
          successMessage: 'Review comment posted',
          invalidates: ['pull-request'],
        },
      ],
    },
    providers: [
      { id: 'github', name: 'GitHub', kind: 'scm' },
      { id: 'github-actions', name: 'GitHub Actions', kind: 'deployment' },
    ],
  }
}
