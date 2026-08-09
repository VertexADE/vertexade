import { rm } from 'node:fs/promises'
import type { PreviewRun } from './detect.ts'

const composeTimeout = 5 * 60_000

function composeDown(run: PreviewRun, projectName: string, composeFile: string) {
  return run('docker', ['compose', '-p', projectName, '-f', composeFile, 'down', '--volumes', '--remove-orphans'], {
    timeoutMs: composeTimeout,
  })
}

async function removeGeneratedFiles(composeFile: string, assetRoot?: string | null) {
  if (assetRoot) await rm(assetRoot, { recursive: true, force: true })
  await rm(composeFile, { force: true })
}

async function forceRemoveComposeContainers(run: PreviewRun, projectName: string) {
  const output = await run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${projectName}`], {
    timeoutMs: 15_000,
  }).catch(() => '')
  const ids = output.trim().split(/\s+/).filter(Boolean)
  if (ids.length) await run('docker', ['rm', '--force', ...ids], { timeoutMs: 60_000 }).catch(() => undefined)
}

export async function cleanupFailedCompose(run: PreviewRun, projectName: string, composeFile: string, assetRoot: string) {
  await composeDown(run, projectName, composeFile).catch(() => forceRemoveComposeContainers(run, projectName))
  await removeGeneratedFiles(composeFile, assetRoot).catch(() => undefined)
}

export async function removeComposePreview(run: PreviewRun, projectName: string, composeFile: string, assetRoot?: string | null) {
  await composeDown(run, projectName, composeFile).catch(() => forceRemoveComposeContainers(run, projectName))
  await removeGeneratedFiles(composeFile, assetRoot)
}
