import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const outputDirectory = process.env.VERTEXADE_WEB_OUTPUT_DIR || '.output'
const assetsDirectory = join(import.meta.dirname, '..', 'apps', 'web', outputDirectory, 'public', 'assets')
const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith('.js'))

const budgets = [
  { label: 'application entry', pattern: /^index-[\w-]+\.js$/, maximumGzipBytes: 160 * 1024 },
  {
    label: 'command palette',
    pattern: /^app-command-palette-[\w-]+\.js$/,
    maximumGzipBytes: 40 * 1024,
  },
  { label: 'KaTeX runtime', pattern: /^katex-[\w-]+\.js$/, maximumGzipBytes: 85 * 1024 },
  {
    label: 'Markdown renderer',
    pattern: /^markdown-content-[\w-]+\.js$/,
    maximumGzipBytes: 140 * 1024,
  },
  {
    label: 'Markdown math adapter',
    pattern: /^markdown-math-content-[\w-]+\.js$/,
    maximumGzipBytes: 10 * 1024,
  },
  { label: 'thread panel', pattern: /^thread-panel-[\w-]+\.js$/, maximumGzipBytes: 90 * 1024 },
  {
    label: 'pull request details',
    pattern: /^pr-details-dialog-[\w-]+\.js$/,
    maximumGzipBytes: 21 * 1024,
  },
  {
    label: 'RxDB dashboard cache bootstrap',
    pattern: /^rxdb-dashboard-cache-[\w-]+\.js$/,
    maximumGzipBytes: 15 * 1024,
  },
  {
    label: 'lazy RxDB storage runtime',
    pattern: /^rxdb-dashboard-storage-[\w-]+\.js$/,
    maximumGzipBytes: 90 * 1024,
  },
]

const results = []
for (const budget of budgets) {
  const matches = files.filter((file) => budget.pattern.test(file))
  if (matches.length !== 1) throw new Error(`Bundle verification failed: expected one ${budget.label} chunk, found ${matches.length}`)
  const source = await readFile(join(assetsDirectory, matches[0]))
  const gzipBytes = gzipSync(source).byteLength
  if (gzipBytes > budget.maximumGzipBytes) {
    throw new Error(
      `Bundle verification failed: ${budget.label} is ${(gzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${(budget.maximumGzipBytes / 1024).toFixed(0)} KiB`,
    )
  }
  results.push(`${budget.label} ${(gzipBytes / 1024).toFixed(1)} KiB`)
}

console.log(`Bundle budgets verified: ${results.join(' · ')}`)
