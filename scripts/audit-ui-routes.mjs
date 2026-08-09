import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { interactionExpression, interactionSteps } from './ui-audit-actions.mjs'

const { values } = parseArgs({
  options: {
    baseUrl: { type: 'string', default: 'http://127.0.0.1:4173' },
    chrome: {
      type: 'string',
      default: '/home/agent/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',
    },
    output: { type: 'string', default: 'artifacts/ui-audit' },
    route: { type: 'string', multiple: true, default: [] },
    theme: { type: 'string', default: 'dark' },
    viewport: { type: 'string', multiple: true, default: [] },
  },
})

const baseUrl = values.baseUrl.replace(/\/$/, '')
const outputDirectory = resolve(values.output)
const availableViewports = [
  { id: 'ultrawide', width: 2560, height: 1440, mobile: false },
  { id: 'wide', width: 1920, height: 1200, mobile: false },
  { id: 'desktop', width: 1440, height: 1000, mobile: false },
  { id: 'laptop', width: 1024, height: 768, mobile: false },
  { id: 'tablet', width: 768, height: 900, mobile: false },
  { id: 'mobile', width: 390, height: 844, mobile: true },
  { id: 'narrow', width: 320, height: 720, mobile: true },
]
const viewports = values.viewport.length
  ? availableViewports.filter((viewport) => values.viewport.includes(viewport.id))
  : availableViewports

const coreRoutes = [
  { id: 'focus', path: '/' },
  {
    id: 'mobile-menu',
    path: '/',
    actionSelectors: ['[data-audit-action="navigation.mobile-menu.header"]'],
    interactionReadySelector: '[data-slot="sidebar"][data-mobile="true"]',
  },
  {
    id: 'mobile-menu-dock',
    path: '/',
    actionSelectors: ['[data-audit-action="navigation.mobile-menu.dock"]'],
    interactionReadySelector: '[data-slot="sidebar"][data-mobile="true"]',
  },
  { id: 'work', path: '/work' },
  { id: 'work-board', path: '/work?view=board' },
  { id: 'work-list', path: '/work?view=list' },
  { id: 'work-completed', path: '/work?view=completed' },
  { id: 'work-batch-delete', path: '/work?view=completed', clickText: 'Delete multiple', interactionOptional: true },
  {
    id: 'work-batch-delete-review',
    path: '/work?view=completed',
    clickTexts: ['Delete multiple', 'Select all in view', 'Review'],
    interactionOptional: true,
  },
  { id: 'work-create', path: '/work?create=1' },
  { id: 'agents', path: '/threads' },
  { id: 'pull-requests', path: '/pull-requests' },
  { id: 'pull-requests-for-you', path: '/pull-requests?view=for-you' },
  { id: 'pull-requests-action', path: '/pull-requests?view=action' },
  { id: 'pull-requests-ready', path: '/pull-requests?view=ready' },
  { id: 'pull-requests-mine', path: '/pull-requests?view=mine' },
  { id: 'pull-requests-all', path: '/pull-requests?view=all' },
  {
    id: 'pull-requests-batch',
    path: '/pull-requests?view=all',
    clickTexts: ['Select visible', 'Batch actions'],
    interactionOptional: true,
  },
  { id: 'pull-request-stacks', path: '/pull-requests?view=stacks' },
  { id: 'delivery', path: '/deployments' },
  { id: 'delivery-attention', path: '/deployments?status=attention' },
  { id: 'delivery-active', path: '/deployments?status=active' },
  { id: 'delivery-current', path: '/deployments?status=current' },
  { id: 'automations', path: '/automations' },
  { id: 'automations-saved', path: '/automations', clickText: 'Saved' },
  { id: 'automations-runs', path: '/automations', clickText: 'Runs' },
  { id: 'automations-log', path: '/automations', clickText: 'Log' },
  { id: 'automation-approvals', path: '/automations?tab=runs&activity=approvals' },
  { id: 'automation-history', path: '/automations?tab=runs&activity=history' },
  { id: 'inbox', path: '/inbox' },
  { id: 'extensions', path: '/extensions' },
  { id: 'system-health', path: '/setup' },
  { id: 'settings', path: '/settings' },
  { id: 'settings-review-defaults', path: '/settings?section=runtime' },
  { id: 'settings-prompts', path: '/settings?section=prompts' },
  {
    id: 'settings-prompt-editor',
    path: '/settings?section=prompts',
    actionSelectors: ['[data-audit-action="settings.prompt.review.edit"]'],
  },
  { id: 'settings-runtime', path: '/settings?section=runtime' },
  { id: 'settings-capabilities', path: '/settings?section=capabilities' },
  {
    id: 'settings-mcp-editor',
    path: '/settings?section=capabilities',
    actionSelectors: ['[data-audit-action="settings.mcp.add"]'],
  },
  { id: 'settings-appearance', path: '/settings?section=appearance' },
  {
    id: 'settings-repository-environment',
    path: '/settings',
    actionSelectors: ['[data-audit-action="settings.repository.environment"]'],
    interactionOptional: true,
  },
]

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

function configuredCoreRoutes(hasThreads, hasPullRequests) {
  const routes = structuredClone(coreRoutes)
  if (hasThreads) routes.find((route) => route.id === 'agents').readySelector = '[data-thread-id]'
  if (hasPullRequests) {
    routes.find((route) => route.id === 'pull-requests').readySelector = '[data-pr-card]'
    routes.find((route) => route.id === 'pull-requests-batch').readySelector = '[data-pr-card]'
  }
  return routes
}

function discoveredWorkRoutes(workItems) {
  const key = workItems[0]?.key
  if (!key) return []
  const dialogItem = workItems.find((item) => item.kind !== 'pr_review') ?? workItems[0]
  const dialogPath = `/work/${dialogItem.key}`
  return [
    { id: 'work-detail', path: `/work/${key}` },
    {
      id: 'work-title-expanded',
      path: `/work/${key}`,
      actionSelectors: ['[data-audit-action="entity.title.expand"]'],
      interactionReadySelector: '[data-audit-state="entity-title-expanded"]',
    },
    { id: 'work-timeline', path: `/work/${key}?section=activity` },
    { id: 'work-runs', path: `/work/${key}?section=threads` },
    { id: 'work-delivery', path: `/work/${key}?section=links` },
    { id: 'work-details', path: `/work/${key}?section=memory` },
    { id: 'work-edit-dialog', path: dialogPath, actionSelectors: ['[data-audit-action="work.edit-outcome"]'] },
    {
      id: 'work-start-thread-dialog',
      path: dialogPath,
      actionSelectors: ['[data-audit-action="work.actions.open"]', '[data-audit-action="work.thread.new-agent"]'],
    },
    ...(dialogItem.kind === 'pr_review'
      ? []
      : [
          {
            id: 'work-review-dialog',
            path: dialogPath,
            actionSelectors: ['[data-audit-action="work.actions.open"]', '[data-audit-action="work.thread.new-review"]'],
          },
        ]),
    {
      id: 'work-delete-dialog',
      path: dialogPath,
      actionSelectors: ['[data-audit-action="work.actions.open"]', '[data-audit-action="work.delete"]'],
    },
  ]
}

function pullRequestAuditRoutes(repositoryId, number) {
  const detailPath = `/pull-requests/${repositoryId}/${number}`
  return [
    { id: 'pull-request-detail', path: detailPath },
    {
      id: 'pull-request-title-expanded',
      path: detailPath,
      actionSelectors: ['[data-audit-action="entity.title.expand"]'],
      interactionReadySelector: '[data-audit-state="entity-title-expanded"]',
    },
    { id: 'pull-request-changes', path: `${detailPath}?tab=changes` },
    { id: 'pull-request-checks', path: `${detailPath}?tab=checks` },
    { id: 'pull-request-commits', path: `${detailPath}?tab=commits` },
    { id: 'pull-request-review', path: detailPath, clickText: 'Submit review' },
    {
      id: 'pull-request-review-request-changes',
      path: detailPath,
      actionSelectors: [
        '[data-audit-action="pull-request.review.open"]',
        '[data-audit-action="pull-request.review.decision.github.request-pr-changes"]',
      ],
      interactionOptional: true,
    },
    { id: 'pull-request-agent-review', path: detailPath, actionSelectors: ['[data-audit-action="pull-request.agent.review"]'] },
    { id: 'pull-request-agent-work', path: detailPath, actionSelectors: ['[data-audit-action="pull-request.agent.work"]'] },
  ]
}

async function discoveredPullRequestRoutes(workItems, pullRequests) {
  for (const pullRequest of pullRequests) {
    try {
      await json(`/api/pulls/${pullRequest.repo_id}/${pullRequest.number}/details`)
      return pullRequestAuditRoutes(pullRequest.repo_id, pullRequest.number)
    } catch {}
  }
  for (const item of workItems.slice(0, 12)) {
    const detail = await json(`/api/work-items/${encodeURIComponent(item.key)}`)
    const pullRequest = detail.resources?.find(
      (resource) => resource.kind === 'pull_request' && resource.repository_id && resource.metadata?.number,
    )
    if (pullRequest) {
      try {
        await json(`/api/pulls/${pullRequest.repository_id}/${pullRequest.metadata.number}/details`)
        return pullRequestAuditRoutes(pullRequest.repository_id, pullRequest.metadata.number)
      } catch {}
    }
  }
  return []
}

async function discoveredReviewSuggestionRoutes(threads) {
  const reviews = threads.filter((thread) => thread.kind === 'review')
  const results = await Promise.allSettled(
    reviews.slice(0, 20).map(async (review) => ({ review, suggestions: await json(`/api/agent-threads/${review.id}/suggestions`) })),
  )
  const selected = results.find(hasReviewSuggestions)?.value.review || reviews[0]
  if (!selected) return []
  return [
    {
      id: 'agent-review-suggestions',
      path: `/threads?thread=${selected.id}&view=details`,
      actionSelectors: ['[data-audit-action="thread.suggestions.open"]'],
      interactionReadySelector: '[data-audit-state="review-suggestion-inline"]',
      readySelector: '[data-slot="dialog-content"]',
    },
  ]
}

function hasReviewSuggestions(result) {
  return result.status === 'fulfilled' && Boolean(result.value.suggestions.suggestions?.length)
}

async function discoverRoutes() {
  const [moduleCatalog, workResult, threadResult, readModel] = await Promise.all([
    json('/api/modules'),
    json('/api/work-items'),
    json('/api/agent-threads'),
    json('/api/read-model?since=0'),
  ])
  const workItems = workResult.items ?? workResult
  const threads = threadResult.threads ?? threadResult
  const pullRequests = (readModel.updates?.pullRequests?.entries || []).map((entry) => entry.value)
  const reviewSuggestionRoutes = await discoveredReviewSuggestionRoutes(threads)
  return [
    ...configuredCoreRoutes(threads.length, pullRequests.length),
    ...discoveredWorkRoutes(workItems),
    ...(threads[0]?.id
      ? [
          { id: 'agent-detail', path: `/threads/${threads[0].id}` },
          {
            id: 'agent-thread-dialog',
            path: `/threads?thread=${threads[0].id}&view=details`,
            readySelector: '[data-slot="dialog-content"]',
          },
        ]
      : []),
    ...reviewSuggestionRoutes,
    ...(await discoveredPullRequestRoutes(workItems, pullRequests)),
    ...(moduleCatalog.modules ?? []).map((module) => ({ id: `extension-${module.id}`, path: `/extensions/${module.id}` })),
  ]
}

async function waitForDevtoolsPort(profileDirectory) {
  const portFile = join(profileDirectory, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split('\n')
      return Number(port)
    } catch {
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 50)
      })
    }
  }
  throw new Error('Chromium DevTools port did not become ready')
}

async function openTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  if (!response.ok) throw new Error(`Could not create Chromium target: ${response.status}`)
  return response.json()
}

function connect(webSocketDebuggerUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    socket.addEventListener('open', () => resolvePromise(socket), { once: true })
    socket.addEventListener('error', rejectPromise, { once: true })
  })
}

function cdp(socket, onEvent) {
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) {
      onEvent(message)
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  return (method, params = {}) =>
    new Promise((resolvePromise, rejectPromise) => {
      const id = ++sequence
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise })
      socket.send(JSON.stringify({ id, method, params }))
    })
}

async function captureRoute(port, route, viewport) {
  const target = await openTarget(port)
  const socket = await connect(target.webSocketDebuggerUrl)
  const exceptions = []
  const consoleErrors = []
  const responseFailures = []
  const send = cdp(socket, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args
        .map((argument) => argument.value ?? argument.description ?? '')
        .filter(Boolean)
        .join(' ')
      const stack = message.params.stackTrace?.callFrames
        .slice(0, 20)
        .map((frame) => `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.lineNumber + 1})`)
        .join('\n')
      consoleErrors.push(stack ? `${text}\n${stack}` : text)
    }
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      responseFailures.push({
        status: message.params.response.status,
        url: message.params.response.url,
      })
    }
  })

  try {
    await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable'), send('Log.enable')])
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    })
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('theme', ${JSON.stringify(values.theme)});`,
    })
    await send('Page.navigate', { url: `${baseUrl}${route.path}` })
    const readiness = await send('Runtime.evaluate', {
      expression: `(async () => {
        const deadline = Date.now() + 30000;
        const readySelector = ${JSON.stringify(route.readySelector || '')};
        while (document.readyState !== 'complete' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const loadingMarkers = [
          'Loading work…',
          'Loading deployment history',
          'Loading pull request…',
          'Loading extension',
          'Loading module catalog',
          'Inspecting this installation…',
          'Loading focus',
          'Loading live workspace…',
          'Opening chat',
        ];
        let marker = '';
        do {
          const routeMain = document.querySelector('[data-slot="workspace-page"]') || document.querySelectorAll('main')[1];
          const routeText = routeMain?.innerText || '';
          marker = loadingMarkers.find((candidate) => routeText.includes(candidate))
            || routeText.slice(0, 500).split('\\n').find((line) => /^(Loading|Opening)\\b/.test(line.trim()))
            || '';
          const routeMainTextLength = routeMain?.innerText.trim().length || 0;
          const routeReady = !readySelector || document.querySelector(readySelector);
          if (marker || routeMainTextLength < 20 || !routeReady) await new Promise((resolve) => setTimeout(resolve, 150));
          else break;
        } while (Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const mainCount = document.querySelectorAll('main').length;
        const finalRouteText = (
          document.querySelector('[data-slot="workspace-page"]')
          || document.querySelectorAll('main')[1]
        )?.innerText || '';
        const mainTextLength = finalRouteText.trim().length;
        const navigation = document.querySelector('[data-audit-shell$="navigation"]');
        const nativeTitlebar = document.querySelector('[data-audit-shell="native-titlebar"]');
        const navigationBounds = navigation?.getBoundingClientRect();
        const titlebarBounds = nativeTitlebar?.getBoundingClientRect();
        const persistentLoading = loadingMarkers.find((candidate) => finalRouteText.includes(candidate))
          || finalRouteText.slice(0, 500).split('\\n').find((line) => /^(Loading|Opening)\\b/.test(line.trim()))
          || (readySelector && !document.querySelector(readySelector) ? 'Expected route data did not render' : '')
          || (mainCount < 1 || mainTextLength < 20 ? 'Route content did not render' : '');
        return {
          url: location.href,
          title: document.title,
          text: document.body.innerText.slice(0, 240),
          textLength: document.body.innerText.length,
          mainCount,
          mainTextLength,
          readyState: document.readyState,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          shell: {
            navigationMode: navigation?.getAttribute('data-audit-shell') || '',
            navigationWidth: navigationBounds ? Math.round(navigationBounds.width) : 0,
            titlebarHeight: titlebarBounds ? Math.round(titlebarBounds.height) : 0,
          },
          persistentLoading,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (readiness.exceptionDetails) throw new Error(readiness.exceptionDetails.text)
    let interaction = null
    if (interactionSteps(route).length) {
      const result = await send('Runtime.evaluate', {
        expression: interactionExpression(route),
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      interaction = result.result.value
    }
    const accessibilityResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const selectors = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="tab"]';
        const visible = (element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return element.getAttribute('aria-hidden') !== 'true'
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && bounds.width > 0
            && bounds.height > 0;
        };
        const name = (element) => {
          const labelledBy = (element.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ');
          const labels = 'labels' in element ? [...(element.labels || [])].map((label) => label.textContent || '').join(' ') : '';
          return [
            element.getAttribute('aria-label'),
            labelledBy,
            labels,
            element.textContent,
            element.getAttribute('title'),
            element.getAttribute('alt'),
            element.getAttribute('placeholder'),
          ].find((value) => value?.trim())?.trim() || '';
        };
        return {
          unnamedInteractive: [...document.querySelectorAll(selectors)]
            .filter(visible)
            .filter((element) => !name(element))
            .map((element) => element.outerHTML.slice(0, 240)),
        };
      })()`,
      returnByValue: true,
    })
    if (accessibilityResult.exceptionDetails) throw new Error(accessibilityResult.exceptionDetails.text)
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const filename = `${viewport.id}-${route.id}.png`
    await writeFile(join(outputDirectory, filename), Buffer.from(screenshot.data, 'base64'))
    return {
      route,
      viewport: viewport.id,
      screenshot: filename,
      interaction,
      accessibility: accessibilityResult.result.value,
      ...readiness.result.value,
      exceptions,
      consoleErrors,
      responseFailures,
    }
  } finally {
    socket.close()
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`)
  }
}

await mkdir(outputDirectory, { recursive: true })
const discoveredRoutes = await discoverRoutes()
const routes = values.route.length ? discoveredRoutes.filter((route) => values.route.includes(route.id)) : discoveredRoutes
const duplicateRouteIds = routes.filter((route, index) => routes.findIndex((candidate) => candidate.id === route.id) !== index)
if (duplicateRouteIds.length) {
  throw new Error(`Duplicate audit route IDs: ${[...new Set(duplicateRouteIds.map((route) => route.id))].join(', ')}`)
}
if (!routes.length) throw new Error(`No routes matched: ${values.route.join(', ')}`)
if (!viewports.length) throw new Error(`No viewports matched: ${values.viewport.join(', ')}`)
await Promise.all(routes.map((route) => fetch(`${baseUrl}${route.path}`).catch(() => undefined)))
const profileDirectory = await mkdtemp(join(tmpdir(), 'vertexade-ui-audit-'))
const chromium = spawn(
  values.chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profileDirectory}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  const port = await waitForDevtoolsPort(profileDirectory)
  const results = []
  for (const viewport of viewports) {
    for (const route of routes) {
      const result = await captureRoute(port, route, viewport)
      results.push(result)
      process.stdout.write(`${viewport.id.padEnd(7)} ${route.id.padEnd(28)} ${result.horizontalOverflow ? 'OVERFLOW' : 'ok'}\n`)
    }
  }
  const failures = results.filter(
    (result) =>
      result.readyState !== 'complete' ||
      result.textLength === 0 ||
      result.persistentLoading ||
      result.horizontalOverflow ||
      (result.viewportWidth >= 1280 &&
        (result.shell.navigationMode !== 'labeled-navigation' ||
          result.shell.navigationWidth < 190 ||
          result.shell.navigationWidth > 194 ||
          result.shell.titlebarHeight < 42 ||
          result.shell.titlebarHeight > 46)) ||
      (result.viewportWidth >= 768 &&
        result.viewportWidth < 1280 &&
        (result.shell.navigationMode !== 'compact-navigation' ||
          result.shell.navigationWidth < 54 ||
          result.shell.navigationWidth > 58 ||
          result.shell.titlebarHeight < 42 ||
          result.shell.titlebarHeight > 46)) ||
      (interactionSteps(result.route).length && !result.route.interactionOptional && !result.interaction?.clicked) ||
      (result.route.interactionReadySelector && !result.interaction?.ready) ||
      result.accessibility.unnamedInteractive.length ||
      result.exceptions.length ||
      result.consoleErrors.length ||
      result.responseFailures.length,
  )
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    theme: values.theme,
    routes,
    viewports,
    results,
    failures,
  }
  await writeFile(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Captured ${results.length} route/view combinations; ${failures.length} failure(s).\n`)
  if (failures.length) process.exitCode = 1
} finally {
  chromium.kill('SIGTERM')
  await new Promise((resolvePromise) => {
    chromium.once('exit', resolvePromise)
  })
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
