import { useEffect } from 'react'

import type { HighlightRule } from '@vertexade/ui/lib/dashboard-types'

type BrowserHighlight = { add: (range: Range) => void }
type HighlightRegistry = {
  set: (name: string, highlight: BrowserHighlight) => void
  delete: (name: string) => void
}

export function highlightOffsets(value: string, phrase: string) {
  const matches: Array<{ start: number; end: number }> = []
  const lower = value.toLocaleLowerCase()
  const needle = phrase.toLocaleLowerCase()
  let cursor = 0
  while (needle && (cursor = lower.indexOf(needle, cursor)) !== -1) {
    matches.push({ start: cursor, end: cursor + needle.length })
    cursor += needle.length
  }
  return matches
}

export function GlobalHighlights({ rules }: { rules: HighlightRule[] }) {
  useEffect(() => {
    const registry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights
    const HighlightConstructor = (window as unknown as { Highlight?: new () => BrowserHighlight }).Highlight
    if (!registry || !HighlightConstructor) return

    const names = rules.map((rule) => `pr-highlight-${rule.id}`)
    const style = document.createElement('style')
    style.dataset.highlightRules = 'true'
    style.textContent = rules
      .map(
        (rule) =>
          `::highlight(pr-highlight-${rule.id}) { background-color: ${rule.color}66; text-decoration: underline 1px ${rule.color}; text-underline-offset: 2px; }`,
      )
      .join('\n')
    document.head.append(style)

    let frame = 0
    function apply() {
      frame = 0
      for (const name of names) registry?.delete(name)
      if (!rules.length || !document.body) return
      const highlights = rules.map(() => new HighlightConstructor!())
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (!node.textContent?.trim() || !parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION'].includes(parent.tagName))
            return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node = walker.nextNode()
      while (node) {
        const value = node.textContent || ''
        rules.forEach((rule, ruleIndex) => {
          for (const match of highlightOffsets(value, rule.text)) {
            const range = document.createRange()
            range.setStart(node!, match.start)
            range.setEnd(node!, match.end)
            highlights[ruleIndex].add(range)
          }
        })
        node = walker.nextNode()
      }
      highlights.forEach((highlight, index) => registry?.set(names[index], highlight))
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, characterData: true, subtree: true })
    schedule()

    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      for (const name of names) registry.delete(name)
      style.remove()
    }
  }, [rules])

  return null
}
