import { describe, expect, it } from 'vite-plus/test'
import { desktopOnboardingDestinationPath, desktopOnboardingSteps } from './desktop-onboarding'

describe('desktop onboarding guide', () => {
  it('covers the primary desktop workflow before setup', () => {
    expect(desktopOnboardingSteps.map((step) => step.id)).toEqual(['welcome', 'work', 'threads', 'pull-requests', 'setup'])
  })

  it('can finish in the workspace or continue into the detailed setup screen', () => {
    expect(desktopOnboardingDestinationPath('workspace')).toBe('/')
    expect(desktopOnboardingDestinationPath('setup')).toBe('/setup')
  })
})
