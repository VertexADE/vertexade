import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const source = resolve(root, 'apps/desktop/dist')
const output = resolve(root, 'apps/server/dist')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
for (const entry of ['api.mjs', 'runtime', 'web']) await cp(resolve(source, entry), resolve(output, entry), { recursive: true })
