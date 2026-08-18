import type { Mermaid, MermaidConfig, RenderResult } from 'mermaid'

export type MermaidColorScheme = 'dark' | 'light'

type MermaidRenderer = Pick<Mermaid, 'initialize' | 'render'>

const initialMermaidEdgeLimit = 2_048
const maximumMermaidEdgeLimit = 8_192
const defaultMermaidTextLimit = 50_000
const maximumMermaidTextLimit = 500_000
const mermaidEdgeLimitPattern = /Edge limit exceeded\.\s+(\d+) edges found/i

function mermaidConfig(scheme: MermaidColorScheme, id: string, fontFamily: string, maxEdges: number, maxTextSize: number): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: scheme === 'dark' ? 'dark' : 'neutral',
    darkMode: scheme === 'dark',
    deterministicIds: true,
    deterministicIDSeed: id,
    htmlLabels: false,
    fontFamily,
    maxEdges,
    maxTextSize,
    flowchart: {
      curve: 'basis',
      nodeSpacing: 32,
      rankSpacing: 48,
      padding: 12,
      useMaxWidth: true,
    },
  }
}

function exceededEdgeCount(cause: unknown): number | null {
  if (!(cause instanceof Error)) return null
  const count = Number(cause.message.match(mermaidEdgeLimitPattern)?.[1])
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

export async function renderMermaidWithCapacity(
  mermaid: MermaidRenderer,
  chart: string,
  id: string,
  scheme: MermaidColorScheme,
  fontFamily: string,
): Promise<RenderResult> {
  if (chart.length > maximumMermaidTextLimit) {
    throw new Error(
      `Diagram source is too large to render safely (${chart.length.toLocaleString()} characters). Split it into focused views.`,
    )
  }
  const maxTextSize = Math.max(defaultMermaidTextLimit, chart.length + 1_024)
  let maxEdges = initialMermaidEdgeLimit
  while (true) {
    mermaid.initialize(mermaidConfig(scheme, id, fontFamily, maxEdges, maxTextSize))
    try {
      return await mermaid.render(id, chart)
    } catch (cause) {
      const found = exceededEdgeCount(cause)
      if (found === null) throw cause
      if (maxEdges >= maximumMermaidEdgeLimit) {
        throw new Error(
          `Diagram contains ${found.toLocaleString()} or more edges and exceeds the safe rendering capacity of ${maximumMermaidEdgeLimit.toLocaleString()}. Split it into focused views.`,
        )
      }
      maxEdges = Math.min(maximumMermaidEdgeLimit, Math.max(maxEdges * 2, found + 1))
    }
  }
}
