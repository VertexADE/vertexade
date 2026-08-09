import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import { useReactiveApi } from './use-reactive-api.ts'

function ServerComponent({ load }: { load(): Promise<{ label: string }> }) {
  const query = useReactiveApi({ key: 'server-render-test', load })
  return <span>{query.data?.label || 'loading'}</span>
}

describe('useReactiveApi', () => {
  it('does not open a browser event stream or load data while server rendering', () => {
    const load = vi.fn(async () => ({ label: 'loaded' }))

    expect(renderToString(<ServerComponent load={load} />)).toContain('loading')
    expect(load).not.toHaveBeenCalled()
  })
})
