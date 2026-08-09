import { definePortableFindingsCollection } from '@vertexade/platform-extension-sdk'

export const codeRabbitFindingsSurface = definePortableFindingsCollection({
  id: 'findings',
  title: 'CodeRabbit findings',
  description: 'Browse review findings, inspect evidence, and launch repository remediation.',
  setupMessage: 'Choose the GitHub repositories CodeRabbit should monitor before using this surface.',
  refreshEventPrefix: 'coderabbit_',
  actions: [
    {
      id: 'request-review',
      label: 'Re-review',
      description: 'Request another CodeRabbit review for this pull request.',
      method: 'POST',
      path: '/re-review',
      inputs: [
        {
          name: 'repository',
          label: 'Repository',
          type: 'hidden',
          required: true,
          defaultSource: 'item',
          defaultPath: 'repository',
        },
        {
          name: 'pr_number',
          label: 'Pull request',
          type: 'hidden',
          required: true,
          defaultSource: 'item',
          defaultPath: 'pr_number',
        },
        {
          name: 'mode',
          label: 'Review mode',
          type: 'select',
          required: true,
          defaultValue: 'incremental',
          options: [
            { value: 'incremental', label: 'Incremental review' },
            { value: 'full', label: 'Full review' },
          ],
        },
      ],
      successMessage: 'CodeRabbit review requested.',
    },
  ],
})
