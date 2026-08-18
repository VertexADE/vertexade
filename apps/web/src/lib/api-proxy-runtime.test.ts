import { describe, expect, it } from 'vite-plus/test'
import type { ApiBackend } from './api-backend'
import type { BrowserPairedServer } from './browser-pairing'
import { createRequestRuntimeState } from './api-proxy-runtime'

const backend: ApiBackend = {
  id: 'studio',
  label: 'Studio',
  url: 'https://studio.example',
  namespace: 1,
  isDefault: false,
}

function paired(sessionToken: string): BrowserPairedServer {
  return {
    id: 'studio',
    name: 'Studio',
    namespace: 1,
    serviceUrl: backend.url,
    credentialId: 'stable-service-credential',
    sessionToken,
    expiresAt: '2099-01-01T00:00:00Z',
  }
}

describe('federated API runtime identity', () => {
  it('isolates cached backend state for separate paired sessions with the same credential id', () => {
    const first = createRequestRuntimeState(new Request('https://frontend.example'), [backend], new Map([['studio', paired('first')]]))
    const second = createRequestRuntimeState(new Request('https://frontend.example'), [backend], new Map([['studio', paired('second')]]))

    expect(first.runtimes.get('studio')).not.toBe(second.runtimes.get('studio'))
    expect(first.federation).not.toBe(second.federation)
  })
})
