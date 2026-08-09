import 'katex/dist/katex.min.css'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

import { MarkdownRenderer, type MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'

export function MarkdownMathContent(props: MarkdownContentProps) {
  return <MarkdownRenderer {...props} enhancements={{ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }} />
}
