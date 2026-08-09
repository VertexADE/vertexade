import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/work')({ ssr: false, component: Outlet })
