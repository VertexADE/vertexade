import { describe, expect, it } from 'vite-plus/test'
import { desktopSidebarOpen, WIDE_DESKTOP_BREAKPOINT } from './responsive-layout'

describe('desktop sidebar layout', () => {
  it('keeps the application rail compact on tablets and laptops', () => {
    expect(desktopSidebarOpen(768)).toBe(false)
    expect(desktopSidebarOpen(1280)).toBe(false)
    expect(desktopSidebarOpen(WIDE_DESKTOP_BREAKPOINT - 1)).toBe(false)
  })

  it('shows labeled navigation on wide desktops', () => {
    expect(desktopSidebarOpen(WIDE_DESKTOP_BREAKPOINT)).toBe(true)
    expect(desktopSidebarOpen(1920)).toBe(true)
  })

  it('respects an explicit desktop preference at every desktop width', () => {
    expect(desktopSidebarOpen(1280, true)).toBe(true)
    expect(desktopSidebarOpen(1920, false)).toBe(false)
  })
})
