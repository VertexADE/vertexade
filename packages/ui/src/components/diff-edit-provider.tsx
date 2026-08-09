import { useCallback, type ReactNode } from 'react'
import { EditProvider, type CreateEditor } from '@pierre/diffs/react'
import { Editor, type EditorOptions } from '@pierre/diffs/edit'

export type DiffEditorState = {
  ready: boolean
  error: string
}

export function createDiffEditor<LAnnotation>(options: EditorOptions<LAnnotation>) {
  return new Editor<LAnnotation>({ ...options, persistState: true })
}

export function DiffEditProvider({ children }: { children: (state: DiffEditorState) => ReactNode }) {
  const createEditor = useCallback<CreateEditor<unknown>>((options) => createDiffEditor(options), [])

  return <EditProvider createEditor={createEditor}>{children({ ready: true, error: '' })}</EditProvider>
}
