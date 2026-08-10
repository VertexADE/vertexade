import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vite-plus/test'

const runFile = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function imageSizePackagePath(): Promise<string> {
  const store = join(root, 'node_modules', '.pnpm')
  const entry = (await readdir(store)).find((name) => name.startsWith('image-size@1.2.1_patch_hash='))
  if (!entry) throw new Error('The audited image-size@1.2.1 dependency is not installed')
  return join(store, entry, 'node_modules', 'image-size')
}

describe('patched dependency security regressions', () => {
  it('terminates on zero-length ICNS entries and ISO media boxes', async () => {
    const packagePath = await imageSizePackagePath()
    const probe = String.raw`
      const imageSize = require(process.argv[1])
      const { findBox } = require(process.argv[1] + '/dist/types/utils.js')

      const icns = Buffer.alloc(16)
      icns.write('icns', 0)
      icns.writeUInt32BE(16, 4)
      icns.write('ic07', 8)
      icns.writeUInt32BE(0, 12)
      try {
        imageSize(icns)
      } catch (error) {
        if (!String(error).includes('Invalid ICNS entry length')) throw error
      }

      const emptyBox = Buffer.alloc(8)
      emptyBox.write('free', 4)
      findBox(emptyBox, 'missing', 0)
      process.stdout.write('safe')
    `
    const result = await runFile(process.execPath, ['-e', probe, packagePath], { timeout: 1_000 })
    expect(result.stdout).toBe('safe')
  })
})
