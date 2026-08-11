import { describe, expect, it } from 'vite-plus/test'
import { mobilePairingDeepLink, pairingTokenFromHash } from './mobile-pair-link.ts'

describe('mobile pair link', () => {
  it('keeps the one-time token in a fragment across the browser-to-app handoff', () => {
    const token = pairingTokenFromHash('#token=TESTPAIRINGTOKEN0000000000000000')
    expect(token).toBe('TESTPAIRINGTOKEN0000000000000000')
    expect(mobilePairingDeepLink('http://100.101.138.108:3773/pair', token!)).toBe(
      'vertexade://pair#origin=http%3A%2F%2F100.101.138.108%3A3773&token=TESTPAIRINGTOKEN0000000000000000',
    )
  })

  it('rejects malformed tokens', () => {
    expect(pairingTokenFromHash('#token=too-short')).toBeNull()
  })
})
