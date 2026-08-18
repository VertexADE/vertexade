import { useEffect, useId, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from 'react'
import DOMPurify from 'dompurify'
import { AlertTriangle, Copy, Download, Loader2, Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@vertexade/ui/components/ui/button'
import { renderMermaidWithCapacity, type MermaidColorScheme } from '@vertexade/ui/lib/mermaid-rendering'
import { cn } from '@vertexade/ui/lib/utils'

type MermaidDiagramProps = {
  chart: string
  title?: string
  className?: string
  viewportClassName?: string
  controls?: boolean
  downloadName?: string
}

let mermaidRenderQueue: Promise<unknown> = Promise.resolve()

function enqueueMermaidRender<T>(render: () => Promise<T>): Promise<T> {
  const next = mermaidRenderQueue.then(render, render)
  mermaidRenderQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function visibleColorScheme(): MermaidColorScheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function useVisibleColorScheme() {
  const [scheme, setScheme] = useState<MermaidColorScheme>('light')
  useEffect(() => {
    const update = () => setScheme(visibleColorScheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-theme-preset'] })
    return () => observer.disconnect()
  }, [])
  return scheme
}

function renderErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Invalid Mermaid diagram'
  return (
    message
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 240) || 'Invalid Mermaid diagram'
  )
}

export function MermaidDiagram({
  chart,
  title = 'Mermaid diagram',
  className,
  viewportClassName,
  controls = true,
  downloadName = 'diagram.svg',
}: MermaidDiagramProps) {
  const id = `mermaid-${useId().replace(/:/g, '')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const scheme = useVisibleColorScheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let active = true
    setSvg('')
    setError('')
    void import('mermaid')
      .then(({ default: mermaid }) => {
        return enqueueMermaidRender(async () => {
          return renderMermaidWithCapacity(mermaid, chart, id, scheme, getComputedStyle(document.body).fontFamily)
        })
      })
      .then((result) => {
        try {
          const sanitized = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { html: true, svg: true, svgFilters: true },
          })
          if (active) setSvg(sanitized)
        } catch (cause) {
          if (active) setError(renderErrorMessage(cause))
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(renderErrorMessage(cause))
      })
    return () => {
      active = false
    }
  }, [chart, id, scheme])

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  function changeZoom(next: number) {
    setZoom(Math.max(0.6, Math.min(2.4, Number(next.toFixed(1)))))
  }

  function fitDiagram() {
    setZoom(1)
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen()
      else await rootRef.current?.requestFullscreen()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Fullscreen is not available')
    }
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(chart)
      toast.success('Mermaid source copied')
    } catch {
      toast.error('Could not copy Mermaid source')
    }
  }

  function downloadSvg() {
    if (!svg) return
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadName.endsWith('.svg') ? downloadName : `${downloadName}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= 1 || !viewportRef.current) return
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !viewportRef.current) return
    viewportRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x)
    viewportRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y)
  }

  function stopPan() {
    drag.current = null
  }

  return (
    <div
      ref={rootRef}
      data-slot="mermaid-diagram"
      className={cn('my-3 flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card', fullscreen && 'h-screen', className)}
    >
      {controls ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/20 px-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{title}</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <DiagramButton label="Zoom out" disabled={zoom <= 0.6} onClick={() => changeZoom(zoom - 0.2)}>
            <ZoomOut />
          </DiagramButton>
          <DiagramButton label="Zoom in" disabled={zoom >= 2.4} onClick={() => changeZoom(zoom + 0.2)}>
            <ZoomIn />
          </DiagramButton>
          <DiagramButton label="Fit diagram" onClick={fitDiagram}>
            <Scan />
          </DiagramButton>
          <DiagramButton label="Copy Mermaid source" onClick={() => void copySource()}>
            <Copy />
          </DiagramButton>
          <DiagramButton label="Download SVG" disabled={!svg} onClick={downloadSvg}>
            <Download />
          </DiagramButton>
          <DiagramButton label={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </DiagramButton>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className={cn(
          'relative min-h-36 flex-1 overflow-auto bg-background/50 p-3',
          zoom > 1 && 'cursor-grab active:cursor-grabbing select-none',
          viewportClassName,
        )}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        {error ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 py-8 text-center" role="alert">
            <AlertTriangle className="size-5 text-destructive" />
            <p className="text-sm font-medium">
              {/edge|too large|rendering capacity/i.test(error) ? 'Diagram is too large to render' : 'Diagram syntax needs attention'}
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <details className="w-full rounded-md border bg-muted/20 text-left">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Show Mermaid source</summary>
              <pre className="max-h-64 overflow-auto border-t p-3 text-xs">{chart}</pre>
            </details>
          </div>
        ) : !svg ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" /> Rendering diagram…
          </div>
        ) : (
          <div
            role="img"
            aria-label={title}
            className="mx-auto origin-top [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
            style={{ width: `${zoom * 100}%` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  )
}

function DiagramButton({ label, ...props }: { label: string } & ComponentProps<typeof Button>) {
  return <Button type="button" variant="ghost" size="icon-xs" aria-label={label} title={label} {...props} />
}
