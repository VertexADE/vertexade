import { open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { BoundedTtlCache } from '@vertexade/platform-server/bounded-cache'

type TranscriptCache = { offset: number; remainder: string; lines: string[]; bytes: number }

const transcriptCache = new BoundedTtlCache<string, TranscriptCache>({
  maxEntries: 32,
  maxBytes: 32 * 1024 * 1024,
  ttlMs: 10 * 60_000,
  slidingTtl: true,
  sizeOf: (cache) => cache.bytes + Buffer.byteLength(cache.remainder),
})
const transcriptEvents = new Set([
  'user_message',
  'agent_message',
  'follow_up_started',
  'turn_completed',
  'input_required',
  'input_answered',
  'error',
])

export async function readFileTail(path: string, maxBytes: number) {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await file.close()
  }
}

async function regularFile(path: string) {
  const file = await stat(path)
  if (!file.isFile()) throw new Error(`Agent log is not a regular file: ${path}`)
  return path
}

export async function resolveReadableLogPath(storedPath: string, logsRoot: string) {
  try {
    return await regularFile(storedPath)
  } catch {
    const root = await realpath(logsRoot)
    const candidate = await realpath(join(root, basename(storedPath)))
    const pathFromRoot = relative(root, candidate)
    if (!pathFromRoot || isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
      throw new Error('Agent log fallback is outside the canonical logs directory')
    }
    return regularFile(candidate)
  }
}

function transcriptLine(line: string) {
  try {
    const value = JSON.parse(line) as { event?: unknown }
    return transcriptEvents.has(String(value.event || ''))
  } catch {
    return false
  }
}

function retainTranscriptLine(cache: TranscriptCache, line: string, maxBytes: number) {
  if (!transcriptLine(line)) return
  const bytes = Buffer.byteLength(line) + 1
  cache.lines.push(line)
  cache.bytes += bytes
  while (cache.bytes > maxBytes && cache.lines.length > 1) {
    const removed = cache.lines.shift()!
    cache.bytes -= Buffer.byteLength(removed) + 1
  }
}

async function readTranscriptPrefix(file: Awaited<ReturnType<typeof open>>, path: string, end: number, maxBytes: number) {
  let cache = transcriptCache.get(path)
  if (!cache || cache.offset > end) {
    cache = { offset: 0, remainder: '', lines: [], bytes: 0 }
  }
  if (cache.offset === end) return cache.lines.join('\n')
  while (cache.offset < end) {
    const length = Math.min(256_000, end - cache.offset)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, cache.offset)
    const parts = `${cache.remainder}${buffer.toString('utf8')}`.split(/\r?\n/)
    cache.remainder = parts.pop() || ''
    for (const line of parts) retainTranscriptLine(cache, line, maxBytes)
    cache.offset += length
  }
  transcriptCache.set(path, cache)
  return cache.lines.join('\n')
}

export function invalidateLogEventContext(path: string) {
  transcriptCache.delete(path)
}

export function logEventContextCacheStats() {
  return { entries: transcriptCache.size, bytes: transcriptCache.retainedBytes }
}

export async function readLogEventContext(path: string, tailSize = 100_000, historySize = 8_000_000) {
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(path, 'r')
  } catch (error) {
    invalidateLogEventContext(path)
    throw error
  }
  try {
    const { size } = await file.stat()
    if (size <= tailSize) {
      invalidateLogEventContext(path)
      return readFileTail(path, tailSize)
    }

    const tailOffset = size - tailSize
    const transcript = await readTranscriptPrefix(file, path, tailOffset, historySize)
    const tailBuffer = Buffer.alloc(tailSize)
    await file.read(tailBuffer, 0, tailSize, tailOffset)
    const tail = tailBuffer.toString('utf8')
    const tailStart = tail.indexOf('\n') + 1

    return `${transcript ? `${transcript}\n` : ''}${tail.slice(tailStart)}`
  } catch (error) {
    invalidateLogEventContext(path)
    throw error
  } finally {
    await file.close()
  }
}
