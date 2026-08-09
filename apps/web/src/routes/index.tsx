import { createFileRoute } from '@tanstack/react-router'
import { FocusOverview } from '../components/focus/focus-overview'

export const Route = createFileRoute('/')({
  ssr: false,
  component: FocusOverview,
})
