import { describe, expect, it } from 'vite-plus/test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createAgentThreadSpawner } from './agent-thread-spawner.ts'

describe('agent thread credential environment', () => {
  it('adds only the credentials resolved for the active repository', async () => {
    const agent = {
      launch: () => ({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(`${process.env.GH_TOKEN}|${process.env.GIT_SSH_COMMAND}`)'],
        env: {},
      }),
    }
    const spawnThread = createAgentThreadSpawner({
      agents: { require: () => agent } as never,
      defaultAgentId: 'test',
      launchContext: new AsyncLocalStorage(),
      localize: (options) => options,
      decorate: (_jobId, options) => options,
      resolveCommand: (command) => command,
      tools: () => ({}),
      environment: (cwd) =>
        cwd === process.cwd() ? { GH_TOKEN: 'repository-token', GIT_SSH_COMMAND: "ssh -i '/keys/repository' -o IdentitiesOnly=yes" } : {},
    })
    const child = spawnThread({}, { cwd: process.cwd() })
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Agent exited with ${code}`))))
    })
    expect(output).toBe("repository-token|ssh -i '/keys/repository' -o IdentitiesOnly=yes")
  })
})
