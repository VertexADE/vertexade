import { describe, expect, it } from 'vite-plus/test'
import { staticChunkCycles, staticChunkDependencies } from './verify-client-chunk-graph.mjs'

describe('client chunk graph verification', () => {
  it('reads only static chunk imports', () => {
    expect(
      [...staticChunkDependencies(`import { value } from './shared.js'; import './setup.js'; import('./lazy.js')`)].sort((left, right) =>
        left.localeCompare(right),
      ),
    ).toEqual(['setup.js', 'shared.js'])
  })

  it('accepts an acyclic application entry', () => {
    const sources = new Map([
      ['index-good.js', `import { shell } from './shell.js'`],
      ['shell.js', `import { icon } from './icons.js'`],
      ['icons.js', `export const icon = 'ok'`],
    ])
    expect(staticChunkCycles(sources)).toEqual([])
  })

  it('rejects a split chunk that imports its application entry', () => {
    const sources = new Map([
      ['index-broken.js', `import { shell } from './app-navigation-shell.js'`],
      ['app-navigation-shell.js', `import { icon } from './index-broken.js'`],
    ])
    expect(staticChunkCycles(sources)).toEqual([['app-navigation-shell.js', 'index-broken.js']])
  })

  it('rejects cycles outside the application entry', () => {
    const sources = new Map([
      ['index-good.js', `import('./thread-panel.js')`],
      ['thread-panel.js', `import { form } from './thread-runtime.js'`],
      ['thread-runtime.js', `import { panel } from './thread-panel.js'`],
    ])
    expect(staticChunkCycles(sources)).toEqual([['thread-panel.js', 'thread-runtime.js']])
  })
})
