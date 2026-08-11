export type MobilePairingDevice = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export type MobilePairingStatus = {
  publicOrigin: string
  invitationExpiresAt: string | null
  devices: MobilePairingDevice[]
}

export type MobilePairingInvitation = {
  pairUrl: string
  expiresAt: string
}

export type MobilePairingRedemption = {
  serviceUrl: string
  sessionToken: string
  expiresAt: string
}
