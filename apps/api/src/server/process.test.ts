import { describe, expect, it } from 'vite-plus/test'
import { processStartIdentity, processWorkingDirectory, runCommand } from './process.ts'

describe('runCommand', () => {
  it('captures bounded command output', async () => {
    await expect(runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'])).resolves.toBe('ok')
    await expect(
      runCommand(process.execPath, ['-e', 'process.stdout.write("toolong")'], {
        maxOutputBytes: 3,
      }),
    ).rejects.toThrow('output exceeded')
  })

  it('terminates commands that exceed their timeout', async () => {
    await expect(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 20 })).rejects.toThrow('timed out')
  })
})

describe('processStartIdentity', () => {
  it('returns the current process start identity and rejects invalid pids', async () => {
    await expect(processStartIdentity(process.pid)).resolves.toMatch(/\S+/)
    await expect(processStartIdentity(-1)).resolves.toBeNull()
    await expect(processWorkingDirectory(process.pid)).resolves.toBe(process.cwd())
  })
})
