import { build } from 'esbuild'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const output = resolve(desktopRoot, 'dist')
const require = createRequire(import.meta.url)
const webRequire = createRequire(resolve(repositoryRoot, 'apps/web/package.json'))

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
    entryPoints: [resolve(desktopRoot, 'src/preload.ts')],
    outfile: resolve(output, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
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

await cp(resolve(desktopRoot, 'runtime/service-runner.mjs'), resolve(output, 'service-runner.mjs'))

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
for (const dependency of ['react', 'tslib']) {
  const dependencyRequire = dependency === 'react' ? webRequire : require
  await cp(dirname(dependencyRequire.resolve(`${dependency}/package.json`)), resolve(output, 'web/server/node_modules', dependency), {
    recursive: true,
    force: true,
  })
}

const bundledServerRoot = resolve(output, 'web/server')
const bundledServerRequire = createRequire(resolve(bundledServerRoot, 'index.mjs'))
const runtimeImports = new Set()
for (const path of await readdir(bundledServerRoot, { recursive: true })) {
  if (!/\.(?:c|m)?js$/.test(path)) continue
  const source = await readFile(resolve(bundledServerRoot, path), 'utf8')
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (!match[1].startsWith('.')) runtimeImports.add(match[1])
  }
}
for (const dependency of runtimeImports) bundledServerRequire.resolve(dependency)
