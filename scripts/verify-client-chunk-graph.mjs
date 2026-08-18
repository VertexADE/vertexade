import { readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function staticChunkDependencies(source) {
  const dependencies = new Set()
  const patterns = [/\bfrom\s*["']\.\/([^"']+\.js)["']/g, /\bimport\s*["']\.\/([^"']+\.js)["']/g]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) dependencies.add(basename(match[1]))
  }
  return dependencies
}

function reachableChunks(graph, start) {
  const reachable = new Set()
  const pending = [start]
  while (pending.length) {
    const current = pending.pop()
    if (!current || reachable.has(current)) continue
    reachable.add(current)
    for (const dependency of graph.get(current) || []) {
      if (graph.has(dependency)) pending.push(dependency)
    }
  }
  return reachable
}

export function staticChunkCycles(sourceByFile) {
  const graph = new Map([...sourceByFile].map(([file, source]) => [file, staticChunkDependencies(source)]))
  const reachability = new Map([...graph.keys()].map((file) => [file, reachableChunks(graph, file)]))
  const cycles = new Map()
  for (const file of graph.keys()) {
    const component = [...reachability.get(file)].filter((candidate) => reachability.get(candidate)?.has(file)).sort()
    if (component.length > 1 || graph.get(file)?.has(file)) cycles.set(component.join('\0'), component)
  }
  return [...cycles.values()].sort((left, right) => left.join('\0').localeCompare(right.join('\0')))
}

export async function verifyClientChunkGraph(assetsDirectory) {
  const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith('.js'))
  const entries = files.filter((file) => /^index-[\w-]+\.js$/.test(file))
  if (entries.length !== 1) throw new Error(`Client chunk verification failed: expected one application entry, found ${entries.length}`)
  const sourceByFile = new Map(await Promise.all(files.map(async (file) => [file, await readFile(join(assetsDirectory, file), 'utf8')])))
  const cycles = staticChunkCycles(sourceByFile)
  if (cycles.length) {
    throw new Error(
      `Client chunk verification failed: found static import cycles: ${cycles.map((cycle) => cycle.join(' <-> ')).join('; ')}`,
    )
  }
  return { entry: entries[0], chunks: files.length }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const outputDirectory = process.env.VERTEXADE_WEB_OUTPUT_DIR || '.output'
  const assetsDirectory = join(import.meta.dirname, '..', 'apps', 'web', outputDirectory, 'public', 'assets')
  const result = await verifyClientChunkGraph(assetsDirectory)
  console.log(`Client chunk graph verified: ${result.entry} is acyclic across ${result.chunks} chunks`)
}
