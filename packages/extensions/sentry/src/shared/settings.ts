import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const sentrySettings = definePortableSettings({
  id: 'settings',
  title: 'Sentry connection',
  description: 'Connect an organization and project to browse production findings.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    {
      name: 'url',
      label: 'Server URL',
      type: 'text',
      required: true,
      defaultValue: 'https://sentry.io',
    },
    { name: 'organization', label: 'Organization slug', type: 'text', required: true },
    { name: 'project', label: 'Project slug', type: 'text' },
    {
      name: 'token',
      label: 'API token',
      type: 'password',
      required: true,
      storedPath: 'has_token',
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save connection',
    successMessage: 'Sentry connection saved.',
  },
})
