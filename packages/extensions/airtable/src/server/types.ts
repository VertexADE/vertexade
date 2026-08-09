export type AirtableCardField = {
  field: string
  style: string
  resolve: boolean
  placement: 'card' | 'detail'
}

export type AirtableWebhookRegistration = {
  id: string
  macSecretBase64: string
  publicUrl: string
  notificationUrl: string
  expirationTime: string | null
}

export type AirtableConfig = {
  token: string
  baseId: string
  tableId: string
  view: string
  titleField: string
  cardFields: AirtableCardField[]
  webhook: AirtableWebhookRegistration | null
}

export type ConfiguredAirtableConfig = AirtableConfig & {
  configured: boolean
}
