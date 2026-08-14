import { useEffect, useMemo, useRef, useState } from 'react'
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge'

export type McpAppFrameDescriptor = {
  serverId: string
  toolName: string
  resourceUri: string
  html: string
  csp: {
    connectDomains: string[]
    resourceDomains: string[]
    frameDomains: string[]
    baseUriDomains: string[]
  }
  permissions: { camera: boolean; microphone: boolean; geolocation: boolean; clipboardWrite: boolean }
}

export type McpAppCallResult = Awaited<ReturnType<NonNullable<AppBridge['oncalltool']>>>

function csp(descriptor: McpAppFrameDescriptor) {
  const domains = descriptor.csp
  return [
    `default-src 'none'`,
    `script-src 'unsafe-inline' ${domains.resourceDomains.join(' ')}`,
    `style-src 'unsafe-inline' ${domains.resourceDomains.join(' ')}`,
    `connect-src ${domains.connectDomains.join(' ') || "'none'"}`,
    `img-src data: blob: ${domains.resourceDomains.join(' ')}`,
    `font-src ${domains.resourceDomains.join(' ') || "'none'"}`,
    `media-src data: blob: ${domains.resourceDomains.join(' ') || "'none'"}`,
    `frame-src ${domains.frameDomains.join(' ') || "'none'"}`,
    `base-uri ${domains.baseUriDomains.join(' ') || "'none'"}`,
    `object-src 'none'`,
    `form-action 'none'`,
  ].join('; ')
}

export function securedMcpAppHtml(descriptor: McpAppFrameDescriptor) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${csp(descriptor).replaceAll('"', '&quot;')}">`
  return descriptor.html.match(/<head(?:\s[^>]*)?>/i)
    ? descriptor.html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}`)
    : `${policy}${descriptor.html}`
}

export function McpAppFrame({
  descriptor,
  callTool,
  toolArguments = {},
  toolResult,
}: {
  descriptor: McpAppFrameDescriptor
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpAppCallResult>
  toolArguments?: Record<string, unknown>
  toolResult?: McpAppCallResult
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const bridge = useRef<AppBridge | null>(null)
  const [height, setHeight] = useState(240)
  const html = useMemo(() => securedMcpAppHtml(descriptor), [descriptor])

  useEffect(() => {
    const frame = iframe.current
    const target = frame?.contentWindow
    if (!frame || !target) return
    const host = new AppBridge(
      null,
      { name: 'VertexADE', version: '0.0.1' },
      { serverTools: {}, openLinks: {}, logging: {} },
      { hostContext: { displayMode: 'inline', containerDimensions: { maxHeight: 1200 } } },
    )
    bridge.current = host
    host.oncalltool = async (params, { signal }) => callTool(params.name, (params.arguments || {}) as Record<string, unknown>, signal)
    host.onopenlink = async ({ url }) => {
      const targetUrl = new URL(url)
      if (targetUrl.protocol !== 'https:') return { isError: true }
      window.open(targetUrl.href, '_blank', 'noopener,noreferrer')
      return {}
    }
    host.onsizechange = ({ height: requested }) => setHeight(Math.min(1200, Math.max(120, requested || 240)))
    host.oninitialized = () => {
      void host.sendToolInput({ arguments: toolArguments })
      if (toolResult) void host.sendToolResult(toolResult)
    }
    void host.connect(new PostMessageTransport(window, target))
    return () => {
      const current = bridge.current
      bridge.current = null
      void current?.teardownResource({}).finally(() => current.close())
    }
  }, [callTool, descriptor.resourceUri, toolArguments, toolResult])

  return (
    <iframe
      ref={iframe}
      title={`${descriptor.toolName} MCP App`}
      srcDoc={html}
      sandbox="allow-scripts"
      allow={buildAllowAttribute(
        Object.fromEntries(
          Object.entries(descriptor.permissions)
            .filter(([, enabled]) => enabled)
            .map(([name]) => [name, {}]),
        ),
      )}
      className="w-full rounded-xl border bg-transparent"
      style={{ height }}
    />
  )
}
