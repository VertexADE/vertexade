import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

describe('Claude Code steering bridge', () => {
  it('acknowledges a steering message after Claude replays it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'claude-steering-'))
    const executable = join(directory, 'claude')
    await writeFile(join(directory, 'package.json'), '{"type":"commonjs"}\n', 'utf8')
    await writeFile(
      executable,
      `#!${process.execPath}
const readline = require('node:readline')
const input = readline.createInterface({ input: process.stdin })
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1', arguments: process.argv.slice(2) }))
input.on('line', (line) => {
  const event = JSON.parse(line)
  console.log(JSON.stringify({ ...event, session_id: 'session-1', isReplay: true }))
  if (event.message.content[0].text === 'steered') {
    setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'session-1', result: 'done' })), 10)
  }
})
`,
      'utf8',
    )
    await chmod(executable, 0o755)
    const bridge = fileURLToPath(new URL('./bridge.ts', import.meta.url))
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), bridge, '--prompt', 'initial'], {
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH || ''}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines: string[] = []
    const errors: string[] = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      lines.push(...String(chunk).split('\n').filter(Boolean))
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => errors.push(String(chunk)))
    child.stdin.write(`${JSON.stringify({ type: 'steer', command_id: 'command-1', prompt: 'steered' })}\n`)
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('exit', resolve)
    })

    expect(exitCode, errors.join('')).toBe(0)
    const events = lines.map((line) => JSON.parse(line))
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'steer_accepted',
        command_id: 'command-1',
        session_id: 'session-1',
      }),
    )
    const launched = events.find((event) => event.type === 'system')
    expect(launched.arguments).toEqual(expect.arrayContaining(['--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config']))
    await rm(directory, { recursive: true })
  })
})
