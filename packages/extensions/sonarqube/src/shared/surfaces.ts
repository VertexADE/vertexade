import { definePortableFindingsCollection } from '@vertexade/platform-extension-sdk'

export const sonarQubeFindingsSurface = definePortableFindingsCollection({
  id: 'findings',
  title: 'SonarQube findings',
  description: 'Browse code-quality findings, inspect evidence, and launch repository remediation.',
  setupMessage: 'Connect SonarQube and choose at least one project before using this surface.',
  refreshEventPrefix: 'sonarqube_',
})
