import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { createPlatformClient } from '@vertexade/platform-client'
import { MobileAgentOptions } from './mobile-agent-options'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

const createClient = jest.mocked(createPlatformClient)
const options = {
  agent: { id: 'codex' },
  agents: [
    { id: 'codex', name: 'Codex', enabled: true },
    { id: 'hidden', name: 'Hidden', enabled: true, selectable: false },
    { id: 'off', name: 'Off', enabled: false },
  ],
  models: [{ id: 'gpt', name: 'GPT', reasoning_efforts: [{ id: 'high' }] }],
}

function clientRequest(request: jest.Mock) {
  createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)
}

describe('MobileAgentOptions', () => {
  test('loads selectable agents and chooses the server default', async () => {
    clientRequest(jest.fn().mockResolvedValue(options))
    const onChange = jest.fn()
    render(<MobileAgentOptions serviceUrl="http://service" backendId="one" value={{ agentId: '', model: '', reasoningEffort: '' }} onChange={onChange} />)
    expect(screen.getByTestId('agent-options-loading')).toBeOnTheScreen()
    await screen.findByTestId('agent-select')
    expect(onChange).toHaveBeenCalledWith({ agentId: 'codex', model: '', reasoningEffort: '' })
  })

  test('selects an agent, model, and reasoning level', async () => {
    clientRequest(jest.fn().mockResolvedValue(options))
    const onChange = jest.fn()
    const { rerender } = render(
      <MobileAgentOptions serviceUrl="http://service" backendId="one" value={{ agentId: 'codex', model: '', reasoningEffort: '' }} onChange={onChange} />,
    )
    await screen.findByTestId('model-select')
    fireEvent(screen.getByTestId('model-select'), 'valueChange', 'gpt')
    expect(onChange).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt', reasoningEffort: '' })
    rerender(<MobileAgentOptions serviceUrl="http://service" backendId="one" value={{ agentId: 'codex', model: 'gpt', reasoningEffort: '' }} onChange={onChange} />)
    fireEvent(screen.getByTestId('reasoning-select'), 'valueChange', 'high')
    expect(onChange).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt', reasoningEffort: 'high' })
  })

  test('shows an actionable failure and retries', async () => {
    const request = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(options)
    clientRequest(request)
    render(<MobileAgentOptions serviceUrl="http://service" backendId="one" value={{ agentId: 'codex', model: '', reasoningEffort: '' }} onChange={jest.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    fireEvent.press(screen.getByText('Retry agent options'))
    await screen.findByTestId('agent-select')
    expect(request).toHaveBeenCalledTimes(2)
  })

  test('ignores a stale response after the selected backend changes', async () => {
    let resolveFirst: ((value: typeof options) => void) | undefined
    const first = new Promise<typeof options>((resolve) => {
      resolveFirst = resolve
    })
    const request = jest.fn().mockReturnValueOnce(first).mockResolvedValueOnce({
      ...options,
      agent: { id: 'new' },
      agents: [{ id: 'new', name: 'New agent', enabled: true }],
    })
    clientRequest(request)
    const onChange = jest.fn()
    const { rerender } = render(
      <MobileAgentOptions serviceUrl="http://service" backendId="one" value={{ agentId: '', model: '', reasoningEffort: '' }} onChange={onChange} />,
    )
    rerender(<MobileAgentOptions serviceUrl="http://service" backendId="two" value={{ agentId: '', model: '', reasoningEffort: '' }} onChange={onChange} />)
    await screen.findByTestId('agent-select')
    await act(async () => resolveFirst?.(options))
    expect(onChange).not.toHaveBeenCalledWith({ agentId: 'codex', model: '', reasoningEffort: '' })
  })
})
