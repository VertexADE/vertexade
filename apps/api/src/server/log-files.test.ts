import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  invalidateLogEventContext,
  logEventContextCacheStats,
  readFileTail,
  readLogEventContext,
  resolveReadableLogPath,
} from './log-files.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('bounded log reads', () => {
  it('recovers a stale checkout path from the canonical logs directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-path-'))
    roots.push(root)
    const logsRoot = join(root, 'current', 'data', 'logs')
    await mkdir(logsRoot, { recursive: true })
    const canonicalPath = join(logsRoot, 'run.log')
    await writeFile(canonicalPath, 'conversation')

    await expect(resolveReadableLogPath(join(root, 'previous', 'data', 'logs', 'run.log'), logsRoot)).resolves.toBe(canonicalPath)
  })

  it('rejects a canonical log symlink that escapes the logs directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-path-'))
    roots.push(root)
    const logsRoot = join(root, 'current', 'data', 'logs')
    const outside = join(root, 'outside.log')
    await mkdir(logsRoot, { recursive: true })
    await writeFile(outside, 'private')
    await symlink(outside, join(logsRoot, 'run.log'))

    await expect(resolveReadableLogPath(join(root, 'previous', 'run.log'), logsRoot)).rejects.toThrow(
      'outside the canonical logs directory',
    )
  })

  it('reads only the requested tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    const path = join(root, 'run.log')
    await writeFile(path, 'prefix\n1234567890')
    await expect(readFileTail(path, 5)).resolves.toBe('67890')
  })

  it('preserves lifecycle events without buffering the full log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    const path = join(root, 'run.log')
    await writeFile(
      path,
      `${JSON.stringify({ event: 'turn_completed' })}\n${'x'.repeat(200)}\n${JSON.stringify({ event: 'agent_message', text: 'done' })}\n`,
    )
    const context = await readLogEventContext(path, 100)
    expect(context).toContain('turn_completed')
    expect(context).toContain('agent_message')
    expect(context).not.toContain('x'.repeat(150))
  })

  it('keeps the complete compact conversation while omitting old technical output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    const path = join(root, 'run.log')
    await writeFile(
      path,
      [
        JSON.stringify({ event: 'user_message', text: 'initial direction' }),
        'x'.repeat(500),
        JSON.stringify({ event: 'agent_message', text: 'first response' }),
        'y'.repeat(500),
        JSON.stringify({ event: 'follow_up_started', display_prompt: 'follow-up direction' }),
        JSON.stringify({ event: 'turn_completed' }),
        'z'.repeat(200),
        JSON.stringify({ event: 'agent_message', text: 'latest response' }),
        '',
      ].join('\n'),
    )
    const context = await readLogEventContext(path, 100, 1_000)
    expect(context).toContain('initial direction')
    expect(context).toContain('first response')
    expect(context).toContain('follow-up direction')
    expect(context).toContain('turn_completed')
    expect(context).toContain('latest response')
    expect(context).not.toContain('x'.repeat(150))
  })

  it('extends cached conversation history without duplicating messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    const path = join(root, 'run.log')
    await writeFile(path, `${JSON.stringify({ event: 'user_message', text: 'first' })}\n${'x'.repeat(200)}\n`)
    await readLogEventContext(path, 50)
    await appendFile(path, `${JSON.stringify({ event: 'agent_message', text: 'second' })}\n${'y'.repeat(200)}\n`)
    const context = await readLogEventContext(path, 50)
    expect(context.match(/"text":"first"/g)).toHaveLength(1)
    expect(context.match(/"text":"second"/g)).toHaveLength(1)
  })

  it('bounds cached transcript paths and retained bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    for (let index = 0; index < 100; index += 1) {
      const path = join(root, `run-${index}.log`)
      await writeFile(path, `${JSON.stringify({ event: 'user_message', text: `message-${index}` })}\n${'x'.repeat(200)}\n`)
      await readLogEventContext(path, 20, 1_000)
    }

    expect(logEventContextCacheStats().entries).toBeLessThanOrEqual(32)
    expect(logEventContextCacheStats().bytes).toBeLessThanOrEqual(32 * 1024 * 1024)
  })

  it('invalidates cached transcript state explicitly and after truncation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-log-'))
    roots.push(root)
    const path = join(root, 'run.log')
    await writeFile(path, `${JSON.stringify({ event: 'user_message', text: 'cached' })}\n${'x'.repeat(200)}\n`)
    await readLogEventContext(path, 20)
    const cachedEntries = logEventContextCacheStats().entries

    invalidateLogEventContext(path)
    expect(logEventContextCacheStats().entries).toBe(cachedEntries - 1)

    await readLogEventContext(path, 20)
    await writeFile(path, 'short')
    await expect(readLogEventContext(path, 20)).resolves.toBe('short')
    expect(logEventContextCacheStats().entries).toBe(cachedEntries - 1)
  })
})
