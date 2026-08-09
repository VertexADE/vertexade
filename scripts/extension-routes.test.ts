import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('extension routes', () => {
  it('renders child routes from the extensions layout', () => {
    expect(source('../apps/web/src/routes/extensions.tsx')).toContain("createFileRoute('/extensions')({ ssr: false, component: Outlet })")
  })

  it('registers the store as the extension index route', () => {
    expect(source('../apps/web/src/routes/extensions.index.tsx')).toContain("createFileRoute('/extensions/')")
    expect(source('../apps/web/src/routeTree.gen.ts')).toMatch(
      /ExtensionsIndexRouteImport\.update\(\{[\s\S]*?getParentRoute: \(\) => ExtensionsRoute/,
    )
  })
})
