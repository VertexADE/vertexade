import { normalizeMobileMarkdown } from './mobile-markdown-normalize'

describe('normalizeMobileMarkdown', () => {
  test('removes single-line and multiline HTML comments', () => {
    expect(normalizeMobileMarkdown('Before<!-- hidden -->after\n<!--\ninternal note\n-->Visible')).toBe('Beforeafter\nVisible')
  })

  test('preserves supported anchor and disclosure markup', () => {
    const content = '<a href="https://example.test">Open</a>\n<details><summary>Work</summary>Actions</details>'
    expect(normalizeMobileMarkdown(content)).toBe(content)
  })
})
