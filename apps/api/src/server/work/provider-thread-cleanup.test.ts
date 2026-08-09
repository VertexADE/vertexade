import { describe, expect, it } from 'vite-plus/test'
import { removeProviderThread } from './provider-thread-cleanup.ts'

describe('provider thread cleanup', () => {
  it('does not make local deletion depend on provider session availability', async () => {
    await expect(
      removeProviderThread(
        {
          deleteThread: async () => {
            throw new Error('Error: failed to delete session')
          },
        },
        'session-1',
      ),
    ).resolves.toBe(false)
  })

  it('treats an already-missing provider session as cleaned', async () => {
    await expect(
      removeProviderThread(
        {
          deleteThread: async () => {
            throw new Error('Session not found')
          },
        },
        'session-1',
      ),
    ).resolves.toBe(true)
  })
})
