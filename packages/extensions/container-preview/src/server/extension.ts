import { PLATFORM_API_VERSION, type DashboardExtension, type ExtensionHostServices } from '@vertexade/platform-contracts'
import { readJsonObject } from '@vertexade/platform-server/http'

type Context = { host: ExtensionHostServices }

function threadId(value: string | undefined) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('A valid preview thread id is required')
  return id
}

export function createExtension({ host }: Context): DashboardExtension {
  const previews = host.workspacePreviews
  if (!previews) throw new Error('The host does not provide workspace preview services')
  return {
    manifest: {
      id: 'container-preview',
      name: 'Container previews',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'deployment',
      description: 'Build and expose isolated developer worktrees with Docker, Compose, Tilt, and Moon.',
      catalog: {
        tagline: 'Run isolated worktrees behind a local preview gateway',
        category: 'automation',
        publisher: { name: 'VertexADE' },
        accent: 'cyan',
        tags: ['Docker', 'Preview', 'Worktrees'],
        highlights: ['Compose and Dockerfile detection', 'Moon workspace support', 'Wildcard-domain gateway'],
      },
      permissions: ['settings.read', 'settings.write', 'process.execute', 'events.emit'],
      setupChecks: [
        {
          id: 'docker',
          name: 'Docker',
          command: 'docker',
          args: ['version', '--format', '{{.Server.Version}}'],
          install: 'Install Docker Engine and allow this user to access the daemon',
        },
      ],
    },
    status: () => ({ configured: Boolean((previews.settings() as { domain?: string }).domain) }),
    register({ routes }) {
      routes.register({
        method: 'GET',
        path: '/settings',
        availability: 'installed',
        handler: () => Response.json(previews.settings()),
      })
      routes.register({
        method: 'POST',
        path: '/settings',
        availability: 'installed',
        handler: async (request) => Response.json(await previews.updateSettings(await readJsonObject(request))),
      })
      routes.register({
        method: 'GET',
        path: '/agent-threads/:threadId',
        handler: async (_request, { params }) => Response.json(await previews.get(threadId(params.threadId))),
      })
      routes.register({
        method: 'POST',
        path: '/agent-threads/:threadId/start',
        handler: async (_request, { params }) => Response.json(await previews.start(threadId(params.threadId)), { status: 202 }),
      })
      routes.register({
        method: 'POST',
        path: '/agent-threads/:threadId/restart',
        handler: async (_request, { params }) => Response.json(await previews.restart(threadId(params.threadId)), { status: 202 }),
      })
      routes.register({
        method: 'POST',
        path: '/agent-threads/:threadId/stop',
        handler: async (_request, { params }) => Response.json(await previews.stop(threadId(params.threadId)), { status: 202 }),
      })
      routes.register({
        method: 'GET',
        path: '/agent-threads/:threadId/logs',
        handler: async (_request, { params }) => Response.json(await previews.logs(threadId(params.threadId))),
      })
    },
  }
}
