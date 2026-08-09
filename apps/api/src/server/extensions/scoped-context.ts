import type {
  ExtensionCommandRunner,
  ExtensionCacheOptions,
  ExtensionCacheResult,
  ExtensionHostServices,
  ExtensionPermission,
  ExtensionRuntimeContext,
} from '@vertexade/platform-contracts'
import { ExtensionCacheStore } from './cache.ts'

type ScopedHostServices = ExtensionHostServices
export type ScopedExtensionContext = ExtensionRuntimeContext<ScopedHostServices, string>

function guardService<T extends object>(
  service: T,
  requirePermission: (permission: ExtensionPermission) => void,
  permission: ExtensionPermission,
): T
function guardService<T extends object>(
  service: T | undefined,
  requirePermission: (permission: ExtensionPermission) => void,
  permission: ExtensionPermission,
): T | undefined
function guardService<T extends object>(
  service: T | undefined,
  requirePermission: (permission: ExtensionPermission) => void,
  permission: ExtensionPermission,
): T | undefined {
  if (!service) return undefined
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        requirePermission(permission)
        return value.apply(target, args)
      }
    },
  })
}

export function createScopedExtensionContext(moduleId: string, context: ScopedExtensionContext) {
  let permissions = new Set<ExtensionPermission>()
  const requirePermission = (permission: ExtensionPermission) => {
    if (!permissions.has(permission)) throw new Error(`${moduleId} extension requires undeclared permission ${permission}`)
  }
  const host = context.host
  if (!host)
    return {
      context,
      setPermissions: (value: ExtensionPermission[]) => {
        permissions = new Set(value)
      },
    }
  const settingName = (name: string) => `extension:${moduleId}:${name}`
  const extensionCache = host.cache instanceof ExtensionCacheStore ? host.cache.scope(moduleId) : host.cache
  const scopedHost = {
    settings: {
      read<T>(name: string, fallback: T) {
        requirePermission('settings.read')
        return host.settings.read(settingName(name), fallback)
      },
      write(name: string, value: unknown) {
        requirePermission('settings.write')
        host.settings.write(settingName(name), value)
      },
      delete(name: string) {
        requirePermission('settings.write')
        host.settings.delete(settingName(name))
      },
      has(name: string) {
        requirePermission('settings.read')
        return host.settings.has(settingName(name))
      },
    },
    repositories: guardService(host.repositories, requirePermission, 'repositories.read'),
    tasks: new Proxy(host.tasks, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        const permission: ExtensionPermission =
          property === 'launch' ? 'tasks.launch' : property === 'followUpInWorktree' ? 'tasks.follow-up' : 'tasks.plan'
        return (...args: unknown[]) => {
          requirePermission(permission)
          return value.apply(target, args)
        }
      },
    }),
    work: host.work
      ? new Proxy(host.work, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver)
            if (typeof value !== 'function') return value
            const permission: ExtensionPermission = property === 'memory' ? 'work.read' : 'work.write'
            return (...args: unknown[]) => {
              requirePermission(permission)
              return value.apply(target, args)
            }
          },
        })
      : undefined,
    events: guardService(host.events, requirePermission, 'events.emit'),
    network: guardService(host.network, requirePermission, 'network.request'),
    ...(extensionCache
      ? {
          cache: {
            getOrLoad<T>(key: string, loader: () => Promise<T>, options: ExtensionCacheOptions): Promise<ExtensionCacheResult<T>> {
              requirePermission('cache.read')
              return extensionCache.getOrLoad(key, loader, options)
            },
            invalidate: (...args: Parameters<typeof extensionCache.invalidate>) => {
              requirePermission('cache.write')
              return extensionCache.invalidate(...args)
            },
            stats: () => {
              requirePermission('cache.read')
              return extensionCache.stats()
            },
          },
        }
      : {}),
    ...(host.scmAuthentication
      ? {
          scmAuthentication: guardService(host.scmAuthentication, requirePermission, 'scm-auth.manage'),
        }
      : {}),
    ...(host.workspacePreviews
      ? {
          workspacePreviews: new Proxy(host.workspacePreviews, {
            get(target, property, receiver) {
              const value = Reflect.get(target, property, receiver)
              if (typeof value !== 'function') return value
              const permission: ExtensionPermission =
                property === 'settings' ? 'settings.read' : property === 'updateSettings' ? 'settings.write' : 'process.execute'
              return (...args: unknown[]) => {
                requirePermission(permission)
                return value.apply(target, args)
              }
            },
          }),
        }
      : {}),
  }
  const scopedContext = {
    ...context,
    host: scopedHost,
    ...(context.run
      ? {
          run: (...args: Parameters<ExtensionCommandRunner<string>>) => {
            requirePermission('process.execute')
            return context.run!(...args)
          },
        }
      : {}),
  }
  return {
    context: scopedContext,
    setPermissions: (value: ExtensionPermission[]) => {
      permissions = new Set(value)
    },
  }
}
