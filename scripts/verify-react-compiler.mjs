import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const outputDirectory = process.env.VERTEXADE_WEB_OUTPUT_DIR || '.output'
const assetsDirectory = join(import.meta.dirname, '..', 'apps', 'web', outputDirectory, 'public', 'assets')
const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith('.js'))
let optimizedChunks = 0
let memoCacheSentinels = 0
const minimumOptimizedChunks = 20
const minimumMemoCacheSentinels = 300

for (const file of files) {
  const source = await readFile(join(assetsDirectory, file), 'utf8')
  const matches = source.match(/memo_cache_sentinel/g)
  if (!matches) continue
  optimizedChunks += 1
  memoCacheSentinels += matches.length
}

if (optimizedChunks < minimumOptimizedChunks || memoCacheSentinels < minimumMemoCacheSentinels) {
  throw new Error(
    `React Compiler verification failed: expected at least ${minimumMemoCacheSentinels} memo caches across ${minimumOptimizedChunks} chunks, received ${memoCacheSentinels} across ${optimizedChunks}`,
  )
}

console.log(`React Compiler verified: ${memoCacheSentinels} memo caches across ${optimizedChunks} client chunks`)
