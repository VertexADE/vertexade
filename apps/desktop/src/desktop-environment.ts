import { delimiter, join } from 'node:path'

const macOsCommandDirectories = (home: string): string[] => [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(home, '.local', 'bin'),
  join(home, '.local', 'share', 'mise', 'shims'),
  join(home, '.nix-profile', 'bin'),
  '/run/current-system/sw/bin',
]

export function desktopRuntimeModeEnvironment(isPackaged: boolean): NodeJS.ProcessEnv {
  return isPackaged ? { NODE_ENV: 'production' } : {}
}

export function desktopServiceEnvironment(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): NodeJS.ProcessEnv {
  if (platform !== 'darwin') return { ...environment }

  const inheritedDirectories = (environment.PATH || '').split(delimiter).filter(Boolean)
  const path = [...new Set([...inheritedDirectories, ...macOsCommandDirectories(home)])].join(delimiter)
  return { ...environment, PATH: path }
}
