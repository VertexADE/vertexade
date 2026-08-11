import { describe, expect, it } from 'vite-plus/test'
import { MobilePairingError, MobilePairingService } from './mobile-pairing.ts'

function memoryStore() {
  let value: unknown
  return {
    read: <T>(_name: string, fallback: T): T => (value === undefined ? fallback : (value as T)),
    write: (_name: string, next: unknown) => {
      value = structuredClone(next)
    },
    value: () => value,
  }
}

function service(now: { value: Date }) {
  const settings = memoryStore()
  return {
    settings,
    pairing: new MobilePairingService(settings, {
      now: () => now.value,
      randomToken: () => 'TESTPAIRINGTOKEN0000000000000000',
      randomSessionId: () => '123e4567-e89b-42d3-a456-426614174000',
      randomSessionSecret: () => 'mobile-secret',
    }),
  }
}

describe('mobile pairing', () => {
  it('creates a full link, stores only digests, and redeems it once', () => {
    const now = { value: new Date('2026-08-11T08:00:00.000Z') }
    const { pairing, settings } = service(now)
    const invitation = pairing.createInvitation('http://100.101.138.108:3773')

    expect(invitation).toEqual({
      pairUrl: 'http://100.101.138.108:3773/pair#token=TESTPAIRINGTOKEN0000000000000000',
      expiresAt: '2026-08-11T08:10:00.000Z',
    })
    expect(JSON.stringify(settings.value())).not.toContain('TESTPAIRINGTOKEN0000000000000000')

    const redemption = pairing.redeem('testpairingtoken0000000000000000', 'Dominic’s iPhone')
    expect(redemption).toEqual({
      serviceUrl: 'http://100.101.138.108:3773',
      sessionToken: '123e4567-e89b-42d3-a456-426614174000.mobile-secret',
      expiresAt: '2026-11-09T08:00:00.000Z',
    })
    expect(JSON.stringify(settings.value())).not.toContain('mobile-secret')
    expect(() => pairing.redeem('TESTPAIRINGTOKEN0000000000000000', 'Other phone')).toThrow('already been used')
  })

  it('expires invitations, validates sessions in constant-size digest form, and revokes devices', () => {
    const now = { value: new Date('2026-08-11T08:00:00.000Z') }
    const { pairing } = service(now)
    pairing.createInvitation('https://vertexade.example')
    now.value = new Date('2026-08-11T08:11:00.000Z')
    try {
      pairing.redeem('TESTPAIRINGTOKEN0000000000000000', 'Phone')
      expect.fail('Expected the expired pairing link to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ code: 'expired_token', status: 410 } satisfies Partial<MobilePairingError>)
    }

    now.value = new Date('2026-08-11T09:00:00.000Z')
    pairing.createInvitation('https://vertexade.example')
    const redemption = pairing.redeem('TESTPAIRINGTOKEN0000000000000000', 'Phone')
    expect(pairing.validate(`Bearer ${redemption.sessionToken}`)).toMatchObject({ name: 'Phone' })
    try {
      pairing.validate('Bearer wrong')
      expect.fail('Expected the malformed session to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_session', status: 401 } satisfies Partial<MobilePairingError>)
    }
    pairing.revoke('123e4567-e89b-42d3-a456-426614174000')
    expect(() => pairing.validate(`Bearer ${redemption.sessionToken}`)).toThrow('invalid')
  })

  it('rejects origins that could smuggle credentials or paths into a pairing link', () => {
    const now = { value: new Date('2026-08-11T08:00:00.000Z') }
    const { pairing } = service(now)
    for (const origin of [
      'file:///tmp/pair',
      'https://user:secret@example.com',
      'https://example.com/prefix',
      'https://example.com/?token=x',
    ]) {
      try {
        pairing.createInvitation(origin)
        expect.fail(`Expected ${origin} to be rejected`)
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_origin', status: 400 } satisfies Partial<MobilePairingError>)
      }
    }
  })
})
