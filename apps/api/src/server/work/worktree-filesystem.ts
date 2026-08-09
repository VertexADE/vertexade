import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export function isPathInside(parent: string, candidate: string) {
  const root = resolve(parent)
  const child = resolve(candidate)
  return child !== root && child.startsWith(`${root}${sep}`)
}

export async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
