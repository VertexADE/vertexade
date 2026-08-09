import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { proxyApiRequest } from '../lib/api-proxy'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: proxyApiRequest,
      POST: proxyApiRequest,
      PUT: proxyApiRequest,
      PATCH: proxyApiRequest,
      DELETE: proxyApiRequest,
      OPTIONS: proxyApiRequest,
    },
  },
})
