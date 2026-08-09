import { describe, expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, buttonVariants } from './button.tsx'

describe('button system', () => {
  it('owns responsive touch sizing for every action size', () => {
    expect(buttonVariants({ size: 'default' })).toContain('h-9')
    expect(buttonVariants({ size: 'default' })).toContain('sm:h-8')
    expect(buttonVariants({ size: 'sm' })).toContain('h-8')
    expect(buttonVariants({ size: 'sm' })).toContain('sm:h-7')
    expect(buttonVariants({ size: 'icon-sm' })).toContain('size-8')
    expect(buttonVariants({ size: 'icon-sm' })).toContain('sm:size-7')
  })

  it('keeps semantic action treatments distinct', () => {
    expect(buttonVariants({ variant: 'default' })).toContain('bg-primary')
    expect(buttonVariants({ variant: 'outline' })).toContain('border-border')
    expect(buttonVariants({ variant: 'destructive' })).toContain('text-destructive')
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-muted')
  })

  it('slots link children without introducing sibling slot targets', () => {
    expect(() =>
      renderToStaticMarkup(createElement(Button, { asChild: true }, createElement('a', { href: '/extensions' }, 'Extensions'))),
    ).not.toThrow()
  })

  it('keeps loading decoration inside a slotted link', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { asChild: true, loading: true }, createElement('a', { href: '/extensions' }, 'Extensions')),
    )
    expect(markup).toContain('data-slot="button-spinner"')
    expect(markup).toContain('href="/extensions"')
  })
})
