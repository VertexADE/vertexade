import { definePortableSettings } from '@vertexade/platform-extension-sdk'

const environmentFields = [
  { name: 'name', label: 'Name', type: 'text' as const, required: true },
  {
    name: 'value',
    label: 'Value',
    type: 'password' as const,
    storedPath: 'has_value',
    required: true,
  },
  { name: 'previous_name', label: 'Previous name', type: 'hidden' as const, valuePath: 'name' },
]

export const acpSettings = definePortableSettings({
  id: 'settings',
  title: 'ACP harnesses',
  description: 'Configure ACP v1 harnesses, permission handling, launch arguments, and encrypted environments.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [
    {
      name: 'registry_agent_ids',
      label: 'Published registry agents',
      type: 'multiselect',
      optionsAction: 'registry',
      optionsPath: 'agents',
      optionValuePath: 'id',
      optionLabelPath: 'name',
      description: 'Load the public ACP registry, then select agents to install through NPX or UVX.',
    },
    {
      name: 'harnesses',
      label: 'Harnesses',
      type: 'object-list',
      valuePath: 'harnesses',
      maxItems: 32,
      addLabel: 'Add harness',
      allowReorder: true,
      fields: [
        { name: 'id', label: 'ID', type: 'text', required: true, placeholder: 'my-agent' },
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'command', label: 'Executable', type: 'text', required: true },
        {
          name: 'args',
          label: 'Arguments',
          type: 'string-list',
          maxItems: 100,
          addLabel: 'Add argument',
        },
        {
          name: 'permission_policy',
          label: 'Permission requests',
          type: 'select',
          defaultValue: 'approve',
          options: [
            { value: 'approve', label: 'Approve requested operations' },
            { value: 'deny', label: 'Deny every request' },
          ],
        },
        { name: 'active', label: 'Active and selectable', type: 'boolean', defaultValue: true },
        { name: 'registry_agent_id', label: 'Registry agent ID', type: 'hidden' },
        {
          name: 'variables',
          label: 'Environment variables',
          type: 'object-list',
          maxItems: 100,
          addLabel: 'Add variable',
          allowReorder: true,
          fields: environmentFields,
        },
      ],
    },
  ],
  sections: [
    { id: 'registry', title: 'ACP registry', fields: ['registry_agent_ids'] },
    { id: 'harnesses', title: 'Harnesses', fields: ['harnesses'] },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save harnesses',
    successMessage: 'ACP harnesses saved.',
  },
  actions: [
    {
      id: 'registry',
      label: 'Load ACP registry',
      method: 'POST',
      path: '/registry',
      intent: 'discover',
    },
  ],
})
