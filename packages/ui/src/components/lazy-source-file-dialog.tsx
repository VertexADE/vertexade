import { lazy, Suspense, type ComponentProps } from 'react'

import type { SourceFileDialog as SourceFileDialogComponent } from '@vertexade/ui/components/source-file-dialog'

const SourceFileDialog = lazy(() =>
  import('@vertexade/ui/components/source-file-dialog').then((module) => ({ default: module.SourceFileDialog })),
)

export function LazySourceFileDialog(props: ComponentProps<typeof SourceFileDialogComponent>) {
  return (
    <Suspense fallback={null}>
      <SourceFileDialog {...props} />
    </Suspense>
  )
}
