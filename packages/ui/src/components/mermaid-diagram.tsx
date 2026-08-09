import { useEffect, useId, useState } from 'react'

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = `mermaid-${useId().replace(/:/g, '')}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
        try {
          const result = await mermaid.render(id, chart)
          if (active) setSvg(result.svg)
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'Invalid Mermaid diagram')
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Mermaid could not be loaded')
      })
    return () => {
      active = false
    }
  }, [chart, id])
  if (error)
    return (
      <div className="my-3 rounded-md border border-red-500/40 bg-red-500/5 p-3">
        <p className="text-xs text-red-400">Mermaid diagram could not be rendered: {error}</p>
        <pre className="mt-2 overflow-x-auto text-xs">{chart}</pre>
      </div>
    )
  if (!svg)
    return <div className="my-3 rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">Rendering diagram…</div>
  return (
    <div
      className="my-3 overflow-x-auto rounded-md border bg-white p-3 text-center [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
