import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@vertexade/ui/components/ui/button'

function LazyLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center gap-2 p-6 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" />
      Loading {label}…
    </div>
  )
}

function LazyLoadFailure({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <AlertTriangle className="size-5 text-amber-400" />
      <div>
        <strong className="text-sm">Could not load {label}</strong>
        <p className="mt-1 text-xs text-muted-foreground">The application may have been updated while this page was open.</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
        <RefreshCw />
        Reload application
      </Button>
    </div>
  )
}

class LazyLoadErrorBoundary extends Component<
  {
    children: ReactNode
    label: string
    resetKey?: string | number | null
  },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Could not load ${this.props.label}`, error, info)
  }

  componentDidUpdate(previous: Readonly<LazyLoadErrorBoundary['props']>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? <LazyLoadFailure label={this.props.label} /> : this.props.children
  }
}

export function LazyBoundary({
  children,
  label,
  fallback,
  resetKey,
}: {
  children: ReactNode
  label: string
  fallback?: ReactNode
  resetKey?: string | number | null
}) {
  return (
    <LazyLoadErrorBoundary label={label} resetKey={resetKey}>
      <Suspense fallback={fallback ?? <LazyLoading label={label} />}>{children}</Suspense>
    </LazyLoadErrorBoundary>
  )
}
