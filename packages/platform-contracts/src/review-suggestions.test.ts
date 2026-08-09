import { describe, expect, it } from 'vite-plus/test'
import { diffLineContent, suggestionMarkdown } from './review-suggestions'

const patch = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -2,4 +2,5 @@
 const stable = true
-const before = 'old'
+const after = 'new'
+
 const tail = true
diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -10 +10 @@
-oldOther()
+newOther()
`

describe('review suggestion helpers', () => {
  it('finds context, added, deleted, renamed, and empty lines at exact diff coordinates', () => {
    expect(diffLineContent(patch, { path: 'src/new.ts', line: 2, side: 'RIGHT' })).toBe('const stable = true')
    expect(diffLineContent(patch, { path: 'src/new.ts', line: 3, side: 'RIGHT' })).toBe("const after = 'new'")
    expect(diffLineContent(patch, { path: 'src/new.ts', line: 4, side: 'RIGHT' })).toBe('')
    expect(diffLineContent(patch, { path: 'src/old.ts', line: 3, side: 'LEFT' })).toBe("const before = 'old'")
    expect(diffLineContent(patch, { path: 'src/other.ts', line: 10, side: 'RIGHT' })).toBe('newOther()')
  })

  it('rejects files, sides, and line numbers that are not represented by the patch', () => {
    expect(diffLineContent(patch, { path: 'src/old.ts', line: 3, side: 'RIGHT' })).toBeNull()
    expect(diffLineContent(patch, { path: 'src/new.ts', line: 40, side: 'RIGHT' })).toBeNull()
    expect(diffLineContent(patch, { path: 'src/missing.ts', line: 3, side: 'RIGHT' })).toBeNull()
    expect(diffLineContent(patch, { path: 'src/other.ts', line: 11, side: 'RIGHT' })).toBeNull()
  })

  it('uses a safe suggestion fence and supports an empty replacement', () => {
    expect(suggestionMarkdown('', '')).toBe('```suggestion\n\n```')
    expect(suggestionMarkdown('Use a literal fence', 'const value = ```raw```\n')).toBe(
      'Use a literal fence\n\n````suggestion\nconst value = ```raw```\n\n````',
    )
    expect(suggestionMarkdown('Normalize', 'first\r\nsecond')).toBe('Normalize\n\n```suggestion\nfirst\nsecond\n```')
  })
})
