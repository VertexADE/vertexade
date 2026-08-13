import * as SecureStore from 'expo-secure-store'
import { parseMobilePairLink, redeemMobilePairLink } from './mobile-pairing'
import { resetMobileSessionCacheForTests } from './mobile-session'

const token = 'TESTPAIRINGTOKEN0000000000000000'

beforeEach(() => {
  jest.restoreAllMocks()
  resetMobileSessionCacheForTests()
})

it('parses full HTTP and app handoff pair links', () => {
  expect(parseMobilePairLink(`http://100.101.138.108:3773/pair#token=${token}`)).toEqual({
    serviceUrl: 'http://100.101.138.108:3773',
    token,
  })
  expect(parseMobilePairLink(`vertexade://pair#origin=http%3A%2F%2F100.101.138.108%3A3773&token=${token}`)).toEqual({
    serviceUrl: 'http://100.101.138.108:3773',
    token,
  })
})

it('redeems once and stores only the issued session in secure storage', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString()
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ serviceUrl: 'http://100.101.138.108:3773', sessionToken: 'paired-session', expiresAt }, { status: 201 }),
  )

  const session = await redeemMobilePairLink(`http://100.101.138.108:3773/pair#token=${token}`, 'Dominic’s iPhone', 'Home Mac')

  expect(session.sessionToken).toBe('paired-session')
  expect(session.name).toBe('Home Mac')
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'vertexade.mobile.sessions.v2',
    expect.not.stringContaining(token),
    expect.objectContaining({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  )
})

it('rejects malformed and origin-changing responses', async () => {
  expect(() => parseMobilePairLink(`https://example.com/not-pair#token=${token}`)).toThrow('invalid')
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ serviceUrl: 'https://attacker.example', sessionToken: 'session', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
  )
  await expect(redeemMobilePairLink(`https://desktop.example/pair#token=${token}`)).rejects.toThrow('invalid pairing response')
})
