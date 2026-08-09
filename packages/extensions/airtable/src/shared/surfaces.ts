import { definePortableCollection } from '@vertexade/platform-extension-sdk'

export const airtableRecordsSurface = definePortableCollection({
  id: 'records',
  title: 'Airtable records',
  description: 'Browse, group, and launch work from the connected Airtable table.',
  source: {
    path: '/board',
    configuredPath: 'configured',
    itemsPath: 'records',
  },
  item: {
    idPath: 'id',
    titlePath: 'title',
    fieldsPath: 'card_fields',
    fieldNamePath: 'name',
    fieldValuePath: 'value',
    fieldStylePath: 'style',
    fieldPlacementPath: 'placement',
    fieldImagePath: 'image_url',
    relationItemsPath: 'relation.items',
    relationIdPath: 'id',
    relationTitlePath: 'title',
    relationImagePath: 'image_url',
  },
  views: {
    list: true,
    pagination: { enabled: true, pageSize: 12 },
    kanban: {
      enabled: true,
      groupFieldsPath: 'card_fields',
      groupFieldNamePath: 'field',
      groupOrderEntriesPath: 'portable_group_order',
      groupOrderEntryFieldPath: 'field',
      groupOrderEntryValuePath: 'value',
    },
  },
  collectionActionsPath: 'portable_collection_actions',
  itemActionsPath: 'portable_actions',
  detail: {
    sections: [{ id: 'activity', title: 'Activity', kind: 'timeline', path: 'portable_activity' }],
  },
  actions: [
    {
      id: 'start-work',
      label: 'Start Work',
      description: 'Launch an implementation thread from this Airtable record.',
      method: 'POST',
      path: '/records/{id}/thread',
      inputs: [
        {
          name: 'repository_id',
          label: 'Repository',
          type: 'select',
          required: true,
          optionsPath: 'repositories',
          optionValuePath: 'id',
          optionLabelPath: 'full_name',
        },
        {
          name: 'create_pr',
          label: 'Create a pull request',
          type: 'boolean',
          defaultValue: true,
        },
      ],
      successMessage: 'Work started from the Airtable record.',
      intent: 'launch-work',
    },
  ],
  setup: {
    message: 'Connect Airtable in extension settings before using this surface.',
    settingsSurfaceId: 'settings',
  },
  refresh: {
    eventPrefixes: ['airtable_'],
  },
})
