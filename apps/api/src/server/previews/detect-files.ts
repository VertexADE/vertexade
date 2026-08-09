import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ignoredDirectories } from './detect-model.ts'

function matchingFile(entry: { isFile(): boolean; name: string }, matches: (name: string) => boolean) {
  return entry.isFile() && matches(entry.name)
}

function searchableDirectory(entry: { isDirectory(): boolean; name: string }, ignored: Set<string>) {
  return entry.isDirectory() && !ignored.has(entry.name)
}

export async function findMatchingFiles(
  directory: string,
  matches: (name: string) => boolean,
  ignored: Set<string>,
  maxDepth: number,
  depth = 0,
): Promise<string[]> {
  if (depth > maxDepth) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries.filter((entry) => matchingFile(entry, matches)).map((entry) => join(directory, entry.name))
  const directories = entries.filter((entry) => searchableDirectory(entry, ignored)).map((entry) => join(directory, entry.name))
  const nested = await Promise.all(directories.map((path) => findMatchingFiles(path, matches, ignored, maxDepth, depth + 1)))
  return [...files, ...nested.flat()].slice(0, 20)
}

export function findDockerfiles(root: string) {
  return findMatchingFiles(root, (name) => /^Dockerfile(?:[._-].+)?$/i.test(name), ignoredDirectories, 4)
}

export function findComposeFiles(root: string) {
  return findMatchingFiles(root, (name) => /^(?:docker-)?compose(?:[._-].+)?\.ya?ml$/i.test(name), ignoredDirectories, 3)
}
