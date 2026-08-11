import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  CURRENT_DESKTOP_ONBOARDING_VERSION,
  DesktopOnboardingStateStore,
  desktopOnboardingState,
  desktopStartupPath,
} from './desktop-onboarding-state.ts'

const temporaryDirectories: string[] = []

async function temporaryUserDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vertexade-onboarding-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('desktop onboarding state', () => {
  it('routes a new desktop profile to onboarding', () => {
    const state = desktopOnboardingState(null)

    expect(state.completed).toBe(false)
    expect(desktopStartupPath(state)).toBe('/onboarding')
  })

  it('persists completion atomically in the desktop user profile', async () => {
    const userDataDirectory = await temporaryUserDataDirectory()
    const store = new DesktopOnboardingStateStore(userDataDirectory, {
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    })

    expect((await store.read()).completed).toBe(false)

    const completed = await store.complete()
    const restored = await store.read()

    expect(completed).toEqual({
      currentVersion: CURRENT_DESKTOP_ONBOARDING_VERSION,
      completedVersion: CURRENT_DESKTOP_ONBOARDING_VERSION,
      completedAt: '2026-08-11T12:00:00.000Z',
      completed: true,
    })
    expect(restored).toEqual(completed)
    expect(desktopStartupPath(restored)).toBe('/')
    expect(await readFile(join(userDataDirectory, 'application-state', 'onboarding.json'), 'utf8')).toContain('2026-08-11T12:00:00.000Z')
  })

  it('recovers from invalid persisted state and reports the failure', async () => {
    const userDataDirectory = await temporaryUserDataDirectory()
    const stateDirectory = join(userDataDirectory, 'application-state')
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(join(stateDirectory, 'onboarding.json'), '{not-json', 'utf8')
    const reportReadError = vi.fn()

    const state = await new DesktopOnboardingStateStore(userDataDirectory, { reportReadError }).read()

    expect(state.completed).toBe(false)
    expect(reportReadError).toHaveBeenCalledOnce()
  })
})
