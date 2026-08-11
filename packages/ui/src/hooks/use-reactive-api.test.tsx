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

    const queryClient = new QueryClient()
    expect(
      renderToString(
        <QueryClientProvider client={queryClient}>
          <ServerComponent load={load} />
        </QueryClientProvider>,
      ),
    ).toContain('loading')
    expect(load).not.toHaveBeenCalled()
  })
})
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
