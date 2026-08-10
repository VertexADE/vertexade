import { describe, expect, it } from 'vite-plus/test'
import { listenerOrigin } from './listener-origin.ts'

describe('listenerOrigin', () => {
  it('creates a trusted request origin from listener configuration', () => {
    expect(listenerOrigin('127.0.0.1', 4174)).toBe('http://127.0.0.1:4174')
    expect(listenerOrigin('::1', 4174)).toBe('http://[::1]:4174')
  })
})
