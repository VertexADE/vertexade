import * as SecureStore from 'expo-secure-store'
import {
  mobileAccessToken,
  readMobileSessionCatalog,
  renameMobileSession,
  resetMobileSessionCacheForTests,
  saveMobileSession,
  selectMobileSession,
} from './mobile-session'

const expiresAt = new Date(Date.now() + 60_000).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  resetMobileSessionCacheForTests()
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
})

test('stores independently paired servers without importing linked servers', async () => {
  await saveMobileSession({ serviceUrl: 'https://one.example', sessionToken: 'one-token', expiresAt })
  await saveMobileSession({ serviceUrl: 'https://two.example', sessionToken: 'two-token', expiresAt })

  expect(await readMobileSessionCatalog()).toEqual({
    activeServiceUrl: 'https://two.example',
    sessions: [
      { serviceUrl: 'https://one.example', sessionToken: 'one-token', expiresAt },
      { serviceUrl: 'https://two.example', sessionToken: 'two-token', expiresAt },
    ],
  })
  expect(await mobileAccessToken('https://one.example')).toBe('one-token')
  expect(await mobileAccessToken('https://two.example')).toBe('two-token')
})

test('switches the active server without changing another server session', async () => {
  await saveMobileSession({ serviceUrl: 'https://one.example', sessionToken: 'one-token', expiresAt })
  await saveMobileSession({ serviceUrl: 'https://two.example', sessionToken: 'two-token', expiresAt })
  await selectMobileSession('https://one.example')

  expect((await readMobileSessionCatalog()).activeServiceUrl).toBe('https://one.example')
  expect(await mobileAccessToken('https://two.example')).toBe('two-token')
})

test('renames a connection without changing its routing identity or token', async () => {
  await saveMobileSession({ serviceUrl: 'https://one.example', sessionToken: 'one-token', expiresAt })
  await renameMobileSession('https://one.example/', '  Personal Mac  ')

  expect((await readMobileSessionCatalog()).sessions).toEqual([
    { serviceUrl: 'https://one.example', sessionToken: 'one-token', expiresAt, name: 'Personal Mac' },
  ])
  expect(await mobileAccessToken('https://one.example')).toBe('one-token')
})

test('keeps a connection name when the same server is paired again without one', async () => {
  await saveMobileSession({ serviceUrl: 'https://one.example', sessionToken: 'old-token', expiresAt, name: 'Home Mac' })
  await saveMobileSession({ serviceUrl: 'https://one.example', sessionToken: 'new-token', expiresAt })

  expect((await readMobileSessionCatalog()).sessions[0]).toEqual({
    serviceUrl: 'https://one.example', sessionToken: 'new-token', expiresAt, name: 'Home Mac',
  })
})
