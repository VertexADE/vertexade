import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const sonarQubeSettings = definePortableSettings({
  id: 'settings',
  title: 'SonarQube connection',
  description: 'Connect a server and choose the projects whose findings are available.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    { name: 'url', label: 'Server URL', type: 'text', required: true },
    {
      name: 'token',
      label: 'API token',
      type: 'password',
      required: true,
      storedPath: 'has_token',
    },
    {
      name: 'projectKeys',
      label: 'Projects',
      type: 'multiselect',
      valuePath: 'project_keys',
      required: true,
      optionsAction: 'discover',
      optionsPath: 'projects',
      optionValuePath: 'key',
      optionLabelPath: 'name',
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save projects',
    successMessage: 'SonarQube projects saved.',
  },
  actions: [
    {
      id: 'discover',
      label: 'Discover projects',
      method: 'POST',
      path: '/projects',
      intent: 'discover',
      includeFields: ['url', 'token'],
    },
  ],
})
