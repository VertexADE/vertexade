import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const apiRoot = join(import.meta.dirname, '..')
const repositoryRoot = resolve(apiRoot, '../../..')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
      }),
    )
  ).flat()
}

describe('API architecture boundaries', () => {
  it('keeps dashboard features behind the composition root', async () => {
    const dashboardRoot = join(apiRoot, 'server', 'dashboard')
    const featureFiles = (await sourceFiles(dashboardRoot)).filter((file) => !file.endsWith('runtime-context.ts'))
    const forbiddenImports = [
      'dashboard-server',
      './pull-request-api',
      './read-model',
      './repository-runtime',
      './review-runtime',
      './system-api',
      './thread-api',
      './thread-runtime',
    ]

    for (const file of featureFiles) {
      const source = await readFile(file, 'utf8')
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
      for (const dependency of forbiddenImports) {
        expect(
          imports.some((specifier) =>
            dependency === 'dashboard-server'
              ? specifier.includes(dependency)
              : specifier === dependency || specifier === `${dependency}.ts`,
          ),
          `${relative(dashboardRoot, file)} must receive ${dependency} through runtime-context`,
        ).toBe(false)
      }
    }
  })

  it('does not add new dependencies from the host to concrete extensions', async () => {
    const imports: string[] = []
    for (const file of await sourceFiles(apiRoot)) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(/from\s+['"](@vertexade\/extension-[^'"]+)['"]/g)) {
        imports.push(`${relative(apiRoot, file)} -> ${match[1]}`)
      }
    }

    expect(imports.sort()).toEqual([])
  })

  it('routes production HTTP calls through the shared Effect client', async () => {
    const roots = [join(apiRoot, 'server'), join(repositoryRoot, 'packages', 'extensions')]
    const directFetches: string[] = []

    for (const root of roots) {
      for (const file of await sourceFiles(root)) {
        const source = await readFile(file, 'utf8')
        if (/\bfetch\s*\(/.test(source)) {
          directFetches.push(relative(repositoryRoot, file))
        }
      }
    }

    expect(directFetches).toEqual([])
  })

  it('keeps the public API surface present while routes are extracted', async () => {
    const source = (await Promise.all((await sourceFiles(apiRoot)).map((file) => readFile(file, 'utf8')))).join('\n')
    const requiredPaths = [
      '/api/read-model',
      '/api/modules',
      '/api/capabilities',
      '/api/settings/extensions',
      '/api/repositories',
      '/api/repositories/sync-all',
      String.raw`\/api\/pulls\/`,
      String.raw`\/api\/agent-threads\/`,
      '/api/automation-recipes',
      '/api/notifications',
      '/api/events',
      '/api/extensions/',
    ]

    for (const path of requiredPaths) expect(source, `missing public API contract ${path}`).toContain(path)
  })

  it('does not reintroduce the Node response compatibility adapter', async () => {
    const source = await readFile(join(apiRoot, 'dashboard-server.ts'), 'utf8')
    for (const marker of ['res.writeHead', 'responseBody', 'Symbol.asyncIterator', 'api(req, res']) {
      expect(source, `legacy HTTP adapter marker ${marker}`).not.toContain(marker)
    }
  })

  it('keeps active host setup and public models provider-neutral', async () => {
    const setup = await readFile(join(apiRoot, 'server', 'setup-status.ts'), 'utf8')
    for (const marker of ['GitHub CLI', 'Codex', 'OpenCode', 'Claude Code']) {
      expect(setup, `provider-specific setup check ${marker}`).not.toContain(marker)
    }
    const dashboard = await readFile(join(apiRoot, 'dashboard-server.ts'), 'utf8')
    for (const marker of [
      'sonarComment',
      'sonarCheckFailed',
      'githubAuthState',
      "'github_review_posted'",
      '/api/github/me',
      'github.com/${repo.full_name}',
      'azure_planning',
    ]) {
      expect(dashboard, `provider-specific host behavior ${marker}`).not.toContain(marker)
    }
  })
})
