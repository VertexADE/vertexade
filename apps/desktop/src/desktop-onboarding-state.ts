import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopOnboardingState } from '@vertexade/platform-contracts'

export const CURRENT_DESKTOP_ONBOARDING_VERSION = 1

type PersistedDesktopOnboardingState = {
  completedVersion: number
  completedAt: string
}

type DesktopOnboardingStateOptions = {
  now?: () => Date
  reportReadError?: (error: unknown) => void
}

function initialDesktopOnboardingState(): DesktopOnboardingState {
  return {
    currentVersion: CURRENT_DESKTOP_ONBOARDING_VERSION,
    completedVersion: null,
    completedAt: null,
    completed: false,
  }
}

function parsePersistedState(value: unknown): PersistedDesktopOnboardingState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (!Number.isInteger(candidate.completedVersion) || Number(candidate.completedVersion) < 1) return null
  if (typeof candidate.completedAt !== 'string' || !Number.isFinite(Date.parse(candidate.completedAt))) return null
  return {
    completedVersion: Number(candidate.completedVersion),
    completedAt: candidate.completedAt,
  }
}

export function desktopOnboardingState(value: unknown): DesktopOnboardingState {
  const persisted = parsePersistedState(value)
  if (!persisted) return initialDesktopOnboardingState()
  return {
    currentVersion: CURRENT_DESKTOP_ONBOARDING_VERSION,
    completedVersion: persisted.completedVersion,
    completedAt: persisted.completedAt,
    completed: persisted.completedVersion >= CURRENT_DESKTOP_ONBOARDING_VERSION,
  }
}

export function desktopStartupPath(state: DesktopOnboardingState): '/' | '/onboarding' {
  return state.completed ? '/' : '/onboarding'
}

export class DesktopOnboardingStateStore {
  readonly #directory: string
  readonly #file: string
  readonly #now: () => Date
  readonly #reportReadError: (error: unknown) => void

  constructor(userDataDirectory: string, options: DesktopOnboardingStateOptions = {}) {
    this.#directory = join(userDataDirectory, 'application-state')
    this.#file = join(this.#directory, 'onboarding.json')
    this.#now = options.now ?? (() => new Date())
    this.#reportReadError = options.reportReadError ?? (() => undefined)
  }

  async read(): Promise<DesktopOnboardingState> {
    try {
      const serialized = await readFile(this.#file, 'utf8')
      return desktopOnboardingState(JSON.parse(serialized))
    } catch (error) {
      if (this.#isMissingFile(error)) return initialDesktopOnboardingState()
      this.#reportReadError(error)
      return initialDesktopOnboardingState()
    }
  }

  async complete(): Promise<DesktopOnboardingState> {
    const persisted: PersistedDesktopOnboardingState = {
      completedVersion: CURRENT_DESKTOP_ONBOARDING_VERSION,
      completedAt: this.#now().toISOString(),
    }
    const temporaryFile = `${this.#file}.${process.pid}.tmp`
    await mkdir(this.#directory, { recursive: true })
    await writeFile(temporaryFile, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryFile, this.#file)
    return desktopOnboardingState(persisted)
  }

  #isMissingFile(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) return false
    return (error as { code?: unknown }).code === 'ENOENT'
  }
}
