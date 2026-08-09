import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const azureDevOpsSettings = definePortableSettings({
  id: 'settings',
  title: 'Azure DevOps connection',
  description: 'Connect Azure Boards for outbound actions, then add a dedicated service-hook password for live inbound refreshes.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    {
      name: 'url',
      label: 'Organization URL',
      type: 'text',
      required: true,
      placeholder: 'https://dev.azure.com/organization',
    },
    { name: 'project', label: 'Project', type: 'text', required: true },
    {
      name: 'pat',
      label: 'Personal access token',
      type: 'password',
      required: true,
      storedPath: 'has_pat',
    },
    {
      name: 'webhook_secret',
      label: 'Service-hook password',
      type: 'password',
      storedPath: 'has_webhook_secret',
      description:
        'Optional. Create Azure DevOps work-item service hooks targeting https://<this-host>/api/extensions/azure-devops/webhook with Basic Auth username vertexade and this password.',
    },
  ],
  sections: [
    {
      id: 'connection',
      title: 'Connection',
      description: 'Used when this board reads or changes Azure work items.',
      fields: ['url', 'project', 'pat'],
    },
    {
      id: 'two-way-sync',
      title: 'Two-way sync',
      description: 'Authenticated Azure work-item changes refresh only this extension board.',
      fields: ['webhook_secret'],
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save connection',
    successMessage: 'Azure DevOps connection saved.',
  },
  actions: [
    {
      id: 'reset',
      label: 'Remove connection',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      confirm: {
        title: 'Remove Azure DevOps connection?',
        description: 'The encrypted organization URL, project, token, and service-hook password will be deleted.',
        confirmLabel: 'Remove connection',
        destructive: true,
      },
    },
  ],
})
