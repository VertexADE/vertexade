import { useEffect, useState } from 'react'
import type { DesktopOnboardingState } from '@vertexade/platform-contracts'
import { BookOpen, Check } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Status } from '@vertexade/ui/components/ui/status'
import { desktopBridge } from '../../lib/desktop-bridge'

export function DesktopOnboardingSettings() {
  const [desktopState, setDesktopState] = useState<DesktopOnboardingState | null>(null)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    setAvailable(true)
    void bridge.onboarding
      .status()
      .then(setDesktopState)
      .catch(() => setDesktopState(null))
  }, [])

  if (!available) return null

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen />
          Desktop onboarding guide
        </CardTitle>
        <CardDescription>Review the Work, Threads, pull-request, and desktop setup walkthrough at any time.</CardDescription>
        {desktopState?.completed && (
          <CardAction>
            <Status tone="success">
              <Check /> Completed
            </Status>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/onboarding">
            <BookOpen data-icon="inline-start" />
            Open guide
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
