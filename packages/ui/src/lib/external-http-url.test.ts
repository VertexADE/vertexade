import { describe, expect, it } from 'vite-plus/test'
import { externalHttpUrl } from './external-http-url'

describe('externalHttpUrl', () => {
  it('accepts absolute HTTP and HTTPS URLs', () => {
    expect(externalHttpUrl('https://github.com/VertexADE/vertexade/pull/7')).toBe('https://github.com/VertexADE/vertexade/pull/7')
    expect(externalHttpUrl('http://localhost:4173/path')).toBe('http://localhost:4173/path')
  })

  it('rejects executable, local-file, credential-bearing, relative, and malformed targets', () => {
    expect(externalHttpUrl('javascript:alert(1)')).toBeNull()
    expect(externalHttpUrl('file:///etc/passwd')).toBeNull()
    expect(externalHttpUrl('https://user:secret@example.com/')).toBeNull()
    expect(externalHttpUrl('/relative')).toBeNull()
    expect(externalHttpUrl('not a url')).toBeNull()
  })
})
