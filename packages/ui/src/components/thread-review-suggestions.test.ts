import { describe, expect, it } from 'vite-plus/test'
import { locateReviewSuggestions, type ReviewSuggestion } from './thread-review-suggestions'

const diff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1,2 @@
-const oldValue = true
+const newValue = true
+const added = true
`

function suggestion(patch: Partial<ReviewSuggestion>): ReviewSuggestion {
  return {
    id: 1,
    path: 'src/example.ts',
    line: 1,
    side: 'RIGHT',
    description: 'Use the new value',
    replacement: 'const newValue = false',
    selected: 1,
    posted_at: null,
    ...patch,
  }
}

describe('review suggestion placement', () => {
  it('places exact current and deleted-line proposals on the real diff', () => {
    const current = suggestion({})
    const deleted = suggestion({ id: 2, side: 'LEFT', replacement: 'const oldValue = false' })
    const located = locateReviewSuggestions([current, deleted], diff)

    expect(located.annotations.map(({ path, line, side }) => ({ path, line, side }))).toEqual([
      { path: 'src/example.ts', line: 1, side: 'RIGHT' },
      { path: 'src/example.ts', line: 1, side: 'LEFT' },
    ])
    expect(located.unmatched).toEqual([])
  })

  it('keeps stale or omitted proposals visible as unmatched fallbacks', () => {
    const stale = suggestion({ line: 40 })
    const missing = suggestion({ id: 2, path: 'src/omitted.ts' })
    const located = locateReviewSuggestions([stale, missing], diff)

    expect(located.annotations).toEqual([])
    expect(located.unmatched).toEqual([stale, missing])
  })
})
