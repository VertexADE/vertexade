import { describe, expect, it } from 'vite-plus/test'
import { hostnameBelongsToDomain } from './gateway.ts'

describe('hostnameBelongsToDomain', () => {
  it('accepts only wildcard children of the configured domain', () => {
    expect(hostnameBelongsToDomain('api-42.previews.example.com', 'previews.example.com')).toBe(true)
    expect(hostnameBelongsToDomain('previews.example.com', 'previews.example.com')).toBe(false)
    expect(hostnameBelongsToDomain('api-42.other.example.com', 'previews.example.com')).toBe(false)
  })
})
