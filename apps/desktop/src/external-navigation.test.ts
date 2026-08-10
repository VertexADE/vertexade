import { describe, expect, it } from 'vite-plus/test'
import { externalNavigationDecision } from './external-navigation'

const applicationOrigin = 'http://127.0.0.1:4173'

describe('externalNavigationDecision', () => {
  it('keeps same-origin navigation inside the application', () => {
    expect(externalNavigationDecision(`${applicationOrigin}/settings`, applicationOrigin)).toBe('internal')
  })

  it('allows only credential-free HTTP(S) targets to leave the application', () => {
    expect(externalNavigationDecision('https://github.com/VertexADE/vertexade', applicationOrigin)).toBe('external')
    expect(externalNavigationDecision('http://example.com/path', applicationOrigin)).toBe('external')
    expect(externalNavigationDecision('https://user:secret@example.com/', applicationOrigin)).toBe('blocked')
  })

  it('blocks executable, local-file, and malformed targets', () => {
    expect(externalNavigationDecision('javascript:alert(1)', applicationOrigin)).toBe('blocked')
    expect(externalNavigationDecision('file:///etc/passwd', applicationOrigin)).toBe('blocked')
    expect(externalNavigationDecision('not a url', applicationOrigin)).toBe('blocked')
  })
})
