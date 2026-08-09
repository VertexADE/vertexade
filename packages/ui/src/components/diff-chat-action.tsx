import type { EditorOptions } from '@pierre/diffs/edit'

import { chatPathFromDocumentUri, languageForPath, selectedLineRange, type ChatCodeSelection } from '@vertexade/ui/lib/code-selection'

export function createAddToChatAction<LAnnotation>(onAddToChat: (selection: ChatCodeSelection) => void, preferredPath?: string) {
  return (context: Parameters<NonNullable<EditorOptions<LAnnotation>['renderSelectionAction']>>[0]) => {
    const path = preferredPath || chatPathFromDocumentUri(context.textDocument.uri)
    const lines = selectedLineRange(context.selection)
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Add to chat'
    button.title = `Add ${path}:${lines.startLine}-${lines.endLine} to the agent message`
    button.setAttribute('aria-label', button.title)
    button.style.cssText = [
      'appearance:none',
      'min-height:30px',
      'border:1px solid color-mix(in lab, var(--diffs-modified-base) 55%, transparent)',
      'border-radius:6px',
      'background:color-mix(in lab, var(--diffs-modified-base) 18%, var(--diffs-widget-bg))',
      'color:var(--diffs-fg)',
      'cursor:pointer',
      'padding:4px 10px',
      'font:600 12px/20px var(--diffs-header-font-fallback)',
      'white-space:nowrap',
    ].join(';')
    button.addEventListener('click', () => {
      const text = context.getSelectionText()
      if (!text) return
      onAddToChat({ path, text, ...lines, language: languageForPath(path) })
      context.close()
    })
    return button
  }
}
