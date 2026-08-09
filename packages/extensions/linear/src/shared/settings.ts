import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const linearSettings = definePortableSettings({
  id: 'settings',
  title: 'Linear connection',
  description: 'Connect Linear for outbound updates, then add a webhook signing secret for live inbound board refreshes.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    {
      name: 'api_key',
      label: 'Personal API key',
      type: 'password',
      required: true,
      storedPath: 'has_api_key',
    },
    {
      name: 'team_ids',
      label: 'Teams',
      type: 'multiselect',
      required: true,
      optionsAction: 'discover',
      optionsPath: 'teams',
      optionValuePath: 'id',
      optionLabelPath: 'name',
    },
    {
      name: 'webhook_secret',
      label: 'Webhook signing secret',
      type: 'password',
      storedPath: 'has_webhook_secret',
      description:
        'Optional. In Linear, create an Issue webhook targeting https://<this-host>/api/extensions/linear/webhook, then paste its signing secret here.',
    },
  ],
  sections: [
    {
      id: 'connection',
      title: 'Connection',
      description: 'Used when this board reads or changes Linear issues.',
      fields: ['api_key', 'team_ids'],
    },
    {
      id: 'two-way-sync',
      title: 'Two-way sync',
      description: 'Verified Linear changes invalidate and refresh only this extension board.',
      fields: ['webhook_secret'],
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save connection',
    successMessage: 'Linear connection saved.',
  },
  actions: [
    {
      id: 'discover',
      label: 'Discover teams',
      method: 'POST',
      path: '/discover',
      intent: 'discover',
      includeFields: ['api_key'],
    },
    {
      id: 'reset',
      label: 'Remove connection',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      confirm: {
        title: 'Remove Linear connection?',
        description: 'The encrypted API key, webhook signing secret, and selected teams will be deleted.',
        confirmLabel: 'Remove connection',
        destructive: true,
      },
    },
  ],
})
