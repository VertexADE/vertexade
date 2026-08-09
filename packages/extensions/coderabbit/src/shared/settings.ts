import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const codeRabbitSettings = definePortableSettings({
  id: 'settings',
  title: 'CodeRabbit repositories',
  description: 'Choose the repositories and bot identities whose unresolved review threads are tracked.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    {
      name: 'bot_logins',
      label: 'Bot identities',
      type: 'string-list',
      defaultValue: ['coderabbitai'],
      maxItems: 10,
      addLabel: 'Add bot identity',
    },
    {
      name: 'repository_ids',
      label: 'Tracked repositories',
      type: 'multiselect',
      required: true,
      optionsPath: 'repositories',
      optionValuePath: 'id',
      optionLabelPath: 'full_name',
      maxItems: 20,
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save repositories',
    successMessage: 'CodeRabbit repositories saved.',
  },
})
