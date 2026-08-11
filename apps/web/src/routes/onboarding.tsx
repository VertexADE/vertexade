import { createFileRoute } from '@tanstack/react-router'
import {
  DesktopOnboarding,
  desktopOnboardingDestinationPath,
  type DesktopOnboardingDestination,
} from '../components/onboarding/desktop-onboarding'

export const Route = createFileRoute('/onboarding')({ ssr: false, component: DesktopOnboardingPage })

function DesktopOnboardingPage() {
  const navigate = Route.useNavigate()
  const complete = (destination: DesktopOnboardingDestination): void => {
    void navigate({ to: desktopOnboardingDestinationPath(destination) })
  }
  return <DesktopOnboarding onComplete={complete} />
}
