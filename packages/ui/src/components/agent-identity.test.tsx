import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import { AgentAvatar } from './agent-identity'

describe('AgentAvatar', () => {
  it.each([
    ['codex', 'Codex', 'openai'],
    ['openai', 'OpenAI', 'openai'],
    ['opencode', 'OpenCode', 'opencode'],
  ])('renders the %s provider logo', (id, name, logo) => {
    expect(renderToStaticMarkup(<AgentAvatar id={id} name={name} />)).toContain(`data-agent-logo="${logo}"`)
  })

  it('renders the Claude provider mark', () => {
    expect(renderToStaticMarkup(<AgentAvatar id="claude-code" name="Claude Code" />)).toContain('data-agent-logo="claude"')
  })

  it('keeps initials as the fallback for other providers', () => {
    expect(renderToStaticMarkup(<AgentAvatar id="custom-agent" name="Custom Agent" />)).toContain('CA')
  })
})
