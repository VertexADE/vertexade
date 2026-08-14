import type { ServerInstallationKind, ServerUpdateInfo } from '@vertexade/platform-contracts'
import { existsSync } from 'node:fs'

function installationKind(environment: NodeJS.ProcessEnv, containerized: boolean): ServerInstallationKind {
  const configured = environment.VERTEXADE_INSTALLATION
  if (configured === 'npm' || configured === 'container' || configured === 'source') return configured
  if (containerized) return 'container'
  if (environment.VERTEXADE_BUNDLED_RUNTIME === '1') return 'source'
  return 'source'
}

export function serverUpdateInfo(
  environment: NodeJS.ProcessEnv = process.env,
  containerized = existsSync('/.dockerenv'),
): ServerUpdateInfo {
  const installation = installationKind(environment, containerized)
  if (installation === 'npm') {
    return {
      installation,
      currentVersion: environment.VERTEXADE_VERSION || 'unknown',
      command: 'npm install --global vertexade@latest',
      restartNote: 'Restart the VertexADE process or service after the package finishes installing.',
      releaseUrl: 'https://github.com/VertexADE/vertexade/releases/latest',
    }
  }
  if (installation === 'container') {
    return {
      installation,
      currentVersion: environment.VERTEXADE_VERSION || 'unknown',
      command: 'docker compose pull && docker compose up -d',
      restartNote: 'Run this from the directory containing the VertexADE Compose configuration.',
      releaseUrl: 'https://github.com/VertexADE/vertexade/releases/latest',
    }
  }
  return {
    installation,
    currentVersion: environment.VERTEXADE_VERSION || 'development',
    command: 'git pull --ff-only && pnpm install --frozen-lockfile && pnpm build',
    restartNote: 'Restart the VertexADE process after the build completes.',
    releaseUrl: 'https://github.com/VertexADE/vertexade/releases/latest',
  }
}
