import { describe, expect, it } from 'vite-plus/test'
import { createDiffPreview, storedDiffSummary, summarizeDiff } from './diff-preview.ts'

const patch = (path: string, lines: number) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${'-old\n+new\n'.repeat(lines)}`

describe('diff previews', () => {
  it('summarizes stored patches', () => {
    expect(summarizeDiff(patch('src/app.ts', 2))).toEqual({
      files: [{ path: 'src/app.ts', additions: 2, deletions: 2, status: 'modified', binary: false }],
      additions: 2,
      deletions: 2,
    })
  })

  it('omits giant files while retaining smaller renderable patches', () => {
    const source = `${patch('small.ts', 2)}${patch('generated.patch', 100)}${patch('other.ts', 2)}`
    const preview = createDiffPreview(source, 500, 250)
    expect(preview.truncated).toBe(true)
    expect(preview.original_bytes).toBeGreaterThan(Buffer.byteLength(preview.diff))
    expect(preview.omitted_files).toEqual(['generated.patch'])
    expect(preview.diff_summary.files.map(({ path }) => path)).toEqual(['small.ts', 'other.ts'])
  })

  it('uses persisted summary columns without reparsing a full diff', () => {
    expect(
      storedDiffSummary({
        diff_files: JSON.stringify([{ path: 'README.md', additions: 3, deletions: 1, status: 'modified', binary: false }]),
        diff_additions: 3,
        diff_deletions: 1,
      }),
    ).toEqual({
      files: [{ path: 'README.md', additions: 3, deletions: 1, status: 'modified', binary: false }],
      additions: 3,
      deletions: 1,
    })
  })
})
