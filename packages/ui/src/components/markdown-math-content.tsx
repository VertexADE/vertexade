import 'katex/dist/katex.min.css'
import katex from 'katex'

import { MarkdownRenderer, type MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'
import { cn } from '@vertexade/ui/lib/utils'

function renderMath(expression: string, display: boolean) {
  const html = katex.renderToString(expression, {
    displayMode: display,
    throwOnError: false,
    trust: false,
  })
  return <span className={cn(display && 'my-3 block overflow-x-auto py-1 text-center')} dangerouslySetInnerHTML={{ __html: html }} />
}

export function MarkdownMathContent(props: MarkdownContentProps) {
  return <MarkdownRenderer {...props} enhancements={{ renderMath }} />
}
