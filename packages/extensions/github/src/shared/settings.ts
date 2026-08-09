import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const githubSettings = definePortableSettings({
  id: 'settings',
  title: 'GitHub authentication',
  description: 'Use the existing gh authentication or encrypted GitHub App installation credentials.',
  source: { path: '/settings', configuredPath: 'connected' },
  fields: [
    { name: 'active', label: 'Use GitHub App authentication', type: 'boolean' },
    {
      name: 'app_id',
      label: 'App ID',
      type: 'text',
      required: true,
      visibleWhen: { input: 'active', equals: true },
    },
    {
      name: 'installation_id',
      label: 'Installation ID',
      type: 'text',
      required: true,
      visibleWhen: { input: 'active', equals: true },
    },
    {
      name: 'private_key',
      label: 'Private key',
      type: 'textarea',
      required: true,
      storedPath: 'has_private_key',
      visibleWhen: { input: 'active', equals: true },
      placeholder: '-----BEGIN PRIVATE KEY-----',
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save authentication',
    successMessage: 'GitHub authentication saved.',
  },
  actions: [
    {
      id: 'reset',
      label: 'Remove app credentials',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      confirm: {
        title: 'Remove GitHub App credentials?',
        description: 'The encrypted installation credentials will be deleted and gh authentication will be used.',
        confirmLabel: 'Remove credentials',
        destructive: true,
      },
    },
  ],
})
