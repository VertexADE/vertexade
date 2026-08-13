import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const yamlPath = resolve(dirname(require.resolve('yaml/package.json')), 'dist/index.js')
const { parseAllDocuments, parseDocument } = require(yamlPath) as typeof import('yaml')

const mobileRoot = resolve(__dirname, '../..')

async function source(path: string) {
  return readFile(resolve(mobileRoot, path), 'utf8')
}

describe('mobile device smoke contract', () => {
  test('uses valid multi-document YAML and covers the full journey', async () => {
    const documents = parseAllDocuments(await source('.maestro/mobile-smoke.yaml'))
    expect(documents).toHaveLength(2)
    expect(documents.flatMap((document) => document.errors)).toEqual([])
    expect(documents[0]?.toJS()).toEqual({ appId: 'com.vertexade.mobile' })
    const flow = JSON.stringify(documents[1]?.toJS())
    for (const marker of [
      'connection-submit',
      'pull-request-fixture-1-299',
      'open-pull-request-fixture-1-299',
      'detail-tab-conversation',
      'detail-tab-checks',
      'detail-tab-changes',
      'create-pullRequests',
      'create-submit',
      'tapOn":"Work',
      'work-item-fixture-1',
      'open-work-item-fixture-1',
      'detail-thread-fixture-1',
      'tapOn":"Threads',
      'thread-fixture-1',
      'open-thread-fixture-1',
      'detail-tab-context',
      'tapOn":"More',
      'extension-work',
      'Agent execution',
      'extension-agents',
      'extension-pull-requests',
      'record-pr-299-details',
      'extension-settings',
      'settings-submit',
      'settings-action-reset',
    ]) {
      expect(flow).toContain(marker)
    }
    expect(flow).toContain('takeScreenshot')
  })

  test('references stable IDs exposed by the native host', async () => {
    const [home, workspace, tabs, chrome, collection, settings, action] = await Promise.all([
      source('src/components/mobile-home-components.tsx'),
      source('src/components/mobile-workspace.tsx'),
      source('app/(tabs)/_layout.tsx'),
      source('src/components/mobile-extension-chrome.tsx'),
      source('src/components/portable-collection-presentation.tsx'),
      source('src/components/portable-settings-content.tsx'),
      source('src/components/portable-collection-action-modal.tsx'),
    ])
    expect(home).toContain('testID="connection-submit"')
    expect(home).toContain('testID={isDefaultServer ? `extension-${module.id}` : `extension-${backendId}-${module.id}`}')
    expect(tabs).toContain('<NativeTabs')
    expect(tabs).toContain('<NativeTabs.Trigger name="pull-requests">')
    expect(workspace).toContain('cardTestID={`work-item-${item.backendId}-${item.id}`}')
    expect(workspace).toContain('cardTestID={`thread-${item.backendId}-${item.id}`}')
    expect(workspace).toContain('openTestID={`open-pull-request-${item.backendId}-${item.repoId}-${item.number}`}')
    expect(workspace).toContain('openTestID={`open-work-item-${item.backendId}-${item.id}`}')
    expect(workspace).toContain('openTestID={`open-thread-${item.backendId}-${item.id}`}')
    expect(chrome).toContain('testID="extension-tab-settings"')
    expect(collection).toContain('testID={`record-${item.id}-details`}')
    expect(collection).toContain('testID={`record-${item.id}-action-${action.id}`}')
    expect(settings).toContain('testID="settings-submit"')
    expect(settings).toContain('testID={`settings-action-${action.id}`}')
    expect(action).toContain('leadingTestID="action-cancel"')
  })

  test('defines manual Android and iOS artifact workflows without an external trigger', async () => {
    const document = parseDocument(await source('.eas/workflows/mobile-e2e.yml'))
    expect(document.errors).toEqual([])
    const workflow = document.toJS() as {
      on?: unknown
      jobs: Record<string, { type: string; params?: Record<string, unknown>; hooks?: Record<string, unknown[]> }>
    }
    expect(workflow.on).toBeUndefined()
    expect(workflow.jobs.build_android).toMatchObject({ type: 'build', params: { platform: 'android', profile: 'e2e-test' } })
    expect(workflow.jobs.build_ios).toMatchObject({ type: 'build', params: { platform: 'ios', profile: 'e2e-test' } })
    for (const jobName of ['test_android', 'test_ios']) {
      expect(workflow.jobs[jobName]).toMatchObject({ type: 'maestro', params: { flow_path: './.maestro/mobile-smoke.yaml', record_screen: true } })
      expect(workflow.jobs[jobName]?.hooks?.before_maestro_tests).toHaveLength(1)
      expect(workflow.jobs[jobName]?.hooks?.after_maestro_tests).toHaveLength(1)
      const hooks = JSON.stringify(workflow.jobs[jobName]?.hooks)
      expect(hooks).toContain('device-runtime-probe.mjs')
      expect(hooks).toContain('startup-')
      expect(hooks).toContain('crash-')
    }
  })

  test('builds installable simulator artifacts for the smoke profile', async () => {
    const configuration = JSON.parse(await source('eas.json'))
    expect(configuration.build['e2e-test']).toMatchObject({
      withoutCredentials: true,
      android: { buildType: 'apk' },
      ios: { simulator: true },
    })
  })
})
