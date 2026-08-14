import { useCallback, useMemo, useRef, useState } from 'react'
import { Linking, useColorScheme, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import type { MobileMcpAppDescriptor } from '@/mobile-agent-resources'

type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function securedHtml(app: MobileMcpAppDescriptor) {
  const domains = app.csp
  const csp = [
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
  const head = `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"', '&quot;')}"><script>(function(){const send=window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);window.postMessage=(value)=>send(JSON.stringify(value));window.__vertexReceive=(value)=>window.dispatchEvent(new MessageEvent('message',{data:value,source:window}));})();</script>`
  return app.html.match(/<head(?:\s[^>]*)?>/i) ? app.html.replace(/<head(?:\s[^>]*)?>/i, (value) => `${value}${head}`) : `${head}${app.html}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function MobileMcpApp({
  app,
  arguments: toolArguments = {},
  result,
  callTool,
}: {
  app: MobileMcpAppDescriptor
  arguments?: Record<string, unknown>
  result?: unknown
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}) {
  const theme = useColorScheme() === 'light' ? 'light' : 'dark'
  const [height, setHeight] = useState(240)
  const webview = useRef<WebView<object>>(null)
  const calls = useRef(new Map<unknown, AbortController>())
  const html = useMemo(() => securedHtml(app), [app])
  const send = useCallback(
    (message: unknown) => webview.current?.injectJavaScript(`window.__vertexReceive(${JSON.stringify(message)});true;`),
    [],
  )
  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let message: RpcMessage
      try {
        message = JSON.parse(event.nativeEvent.data) as RpcMessage
      } catch {
        return
      }
      const params = record(message.params)
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostCapabilities: { serverTools: {}, openLinks: {} },
            hostInfo: { name: 'VertexADE Mobile', version: '0.0.1' },
            hostContext: {
              theme,
              displayMode: 'inline',
              availableDisplayModes: ['inline'],
              containerDimensions: { maxHeight: 1200 },
              platform: 'mobile',
              deviceCapabilities: { touch: true, hover: false },
            },
          },
        })
        return
      }
      if (message.method === 'ui/notifications/initialized') {
        send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: toolArguments } })
        if (result !== undefined) send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result })
        return
      }
      if (message.method === 'ui/notifications/size-changed') {
        setHeight(Math.min(1200, Math.max(120, Number(params.height) || 240)))
        return
      }
      if (message.method === 'tools/call' && message.id !== undefined) {
        const controller = new AbortController()
        calls.current.set(message.id, controller)
        try {
          const output = await callTool(String(params.name || ''), record(params.arguments), controller.signal)
          send({ jsonrpc: '2.0', id: message.id, result: output })
        } catch (error) {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
        } finally {
          calls.current.delete(message.id)
        }
        return
      }
      if (message.method === 'notifications/cancelled') {
        calls.current.get(params.requestId)?.abort()
        calls.current.delete(params.requestId)
        return
      }
      if (message.method === 'ui/open-link' && message.id !== undefined) {
        const url = String(params.url || '')
        if (url.startsWith('https://')) await Linking.openURL(url)
        send({ jsonrpc: '2.0', id: message.id, result: {} })
      }
    },
    [callTool, result, send, theme, toolArguments],
  )
  return (
    <View style={{ height, overflow: 'hidden', borderRadius: 16 }}>
      <WebView<object>
        ref={webview}
        source={{ html, baseUrl: 'https://mcp-app.invalid/' }}
        originWhitelist={['https://*']}
        onMessage={(event: WebViewMessageEvent) => void onMessage(event)}
        javaScriptEnabled
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows={false}
        geolocationEnabled={app.permissions.geolocation}
        mediaCapturePermissionGrantType={app.permissions.camera || app.permissions.microphone ? 'prompt' : 'deny'}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
        style={{ height, backgroundColor: 'transparent' }}
      />
    </View>
  )
}
