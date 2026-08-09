import { definePortableFindingsCollection } from '@vertexade/platform-extension-sdk'

export const sentryFindingsSurface = definePortableFindingsCollection({
  id: 'findings',
  title: 'Sentry findings',
  description: 'Browse production issues, inspect evidence, and launch repository remediation.',
  setupMessage: 'Connect a Sentry organization before using this surface.',
  refreshEventPrefix: 'sentry_',
})
