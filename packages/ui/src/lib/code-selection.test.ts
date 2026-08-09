import { describe, expect, it } from 'vite-plus/test'

import {
  appendCodeSelectionToPrompt,
  chatPathFromDocumentUri,
  formatCodeSelectionForChat,
  languageForPath,
  selectedLineRange,
  sourcePathForWorktree,
} from '@vertexade/ui/lib/code-selection'

describe('code selection chat context', () => {
  it('uses human line numbers and excludes a trailing empty selection line', () => {
    expect(
      selectedLineRange({
        start: { line: 3, character: 2 },
        end: { line: 5, character: 0 },
      }),
    ).toEqual({ startLine: 4, endLine: 5 })
  })

  it('labels common source languages', () => {
    expect(languageForPath('packages/ui/src/example.tsx')).toBe('tsx')
    expect(languageForPath('Dockerfile')).toBe('')
  })

  it('normalizes combined-workspace event paths to the repository worktree', () => {
    expect(sourcePathForWorktree('vertexade--vertexade/apps/portal/package.json', '/managed/work-items/W-0082/vertexade--vertexade')).toBe(
      'apps/portal/package.json',
    )
    expect(sourcePathForWorktree('apps/portal/package.json', '/managed/work-items/W-0082/vertexade--vertexade')).toBe(
      'apps/portal/package.json',
    )
  })

  it('turns editor file URIs back into readable relative chat paths', () => {
    expect(chatPathFromDocumentUri('file:///apps/portal/My%20file.tsx')).toBe('apps/portal/My file.tsx')
    expect(chatPathFromDocumentUri('packages/ui/src/example.tsx')).toBe('packages/ui/src/example.tsx')
  })

  it('formats neutral file context without breaking on nested fences', () => {
    expect(
      formatCodeSelectionForChat({
        path: 'README.md',
        text: '```ts\nconst ready = true\n```',
        startLine: 8,
        endLine: 10,
      }),
    ).toBe('Code context from `README.md:8-10`:\n\n````markdown\n```ts\nconst ready = true\n```\n````')
  })

  it('appends selections to an existing direction with readable spacing', () => {
    expect(
      appendCodeSelectionToPrompt('Please simplify this.', {
        path: 'src/app.ts',
        text: 'const value = 1',
        startLine: 2,
        endLine: 2,
      }),
    ).toBe('Please simplify this.\n\nCode context from `src/app.ts:2`:\n\n```typescript\nconst value = 1\n```')
  })
})
