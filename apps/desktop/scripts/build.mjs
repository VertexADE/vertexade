import { build } from 'esbuild'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const output = resolve(desktopRoot, 'dist')
const require = createRequire(import.meta.url)

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const extensionRoot = resolve(repositoryRoot, 'packages/extensions')
const runtimeRoot = resolve(output, 'runtime')
const extensionNames = await readdir(extensionRoot)
const runtimeExecutables = new Map([
  ['acp', ['bridge.ts']],
  ['claude-code', ['bridge.ts']],
  ['codex', ['start-thread.ts']],
  ['opencode', ['bridge.ts']],
])
await mkdir(runtimeRoot, { recursive: true })
await writeFile(resolve(runtimeRoot, 'package.json'), '{"type":"module"}\n')

await Promise.all([
  build({
    entryPoints: [resolve(desktopRoot, 'src/main.ts')],
    outfile: resolve(output, 'main.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', 'electron-updater'],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(repositoryRoot, 'apps/api/src/server/index.ts')],
    outfile: resolve(output, 'api.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    banner: {
      js: "import { createRequire as __vertexadeCreateRequire } from 'node:module'; const require = __vertexadeCreateRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: [resolve(repositoryRoot, 'apps/api/src/server/agents/subagent-mcp.ts')],
    outfile: resolve(output, 'subagent-mcp.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    banner: {
      js: "import { createRequire as __vertexadeCreateRequire } from 'node:module'; const require = __vertexadeCreateRequire(import.meta.url);",
    },
  }),
])

await Promise.all(
  extensionNames.map(async (name) => {
    const sourceRoot = resolve(extensionRoot, name)
    const destination = resolve(runtimeRoot, 'packages/extensions', name)
    await build({
      entryPoints: [resolve(sourceRoot, 'src/server/extension.ts')],
      outfile: resolve(destination, 'src/server/extension.js'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: true,
      banner: {
        js: "import { createRequire as __vertexadeCreateRequire } from 'node:module'; const require = __vertexadeCreateRequire(import.meta.url);",
      },
    })
    await Promise.all(
      (runtimeExecutables.get(name) || []).map((file) =>
        build({
          entryPoints: [resolve(sourceRoot, 'src/server', file)],
          outfile: resolve(destination, 'src/server', file),
          bundle: true,
          platform: 'node',
          format: 'esm',
          target: 'node22',
          banner: {
            js: "import { createRequire as __vertexadeCreateRequire } from 'node:module'; const require = __vertexadeCreateRequire(import.meta.url);",
          },
        }),
      ),
    )
    await cp(resolve(sourceRoot, 'src/server/skills'), resolve(destination, 'src/server/skills'), { recursive: true, force: true }).catch(
      (error) => {
        if (error.code !== 'ENOENT') throw error
      },
    )
    await cp(resolve(sourceRoot, 'assets'), resolve(destination, 'assets'), { recursive: true, force: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }),
)

await cp(resolve(repositoryRoot, 'apps/web/.output'), resolve(output, 'web'), { recursive: true, force: true })
await cp(dirname(require.resolve('tslib/package.json')), resolve(output, 'web/server/node_modules/tslib'), {
  recursive: true,
  force: true,
})
