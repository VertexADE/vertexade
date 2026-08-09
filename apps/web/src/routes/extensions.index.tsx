import { createFileRoute } from '@tanstack/react-router'
import { ExtensionsPage } from './extensions'

export const Route = createFileRoute('/extensions/')({ component: ExtensionsPage })
