import { describe, expect, it } from 'vite-plus/test'
import type { ToolKind } from '@agentclientprotocol/sdk'
import { acpMcpServers, acpSessionContext, permissionDecision, updateEvent } from './bridge.ts'

const permission = (kind: ToolKind) => ({
  sessionId: 'session-1',
  toolCall: { toolCallId: 'tool-1', kind },
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' as const },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' as const },
  ],
})

describe('ACP bridge policy', () => {
  it('rejects mutating review requests but allows read requests', () => {
    expect(permissionDecision(permission('edit'), { permissionPolicy: 'approve', reviewMode: true }).outcome).toEqual({
      outcome: 'selected',
      optionId: 'reject',
    })
    expect(permissionDecision(permission('read'), { permissionPolicy: 'approve', reviewMode: true }).outcome).toEqual({
      outcome: 'selected',
      optionId: 'allow',
    })
  })

  it('accumulates streamed message chunks into dashboard messages', () => {
    const first = updateEvent({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } }, 'session-1', '')
    const second = updateEvent(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } },
      'session-1',
      first.accumulatedText,
    )
    expect(second.event).toEqual({
      event: 'agent_message',
      thread_id: 'session-1',
      text: 'Hello world',
      streaming: true,
    })
  })

  it('maps tool and plan updates into the shared timeline contract', () => {
    const started = updateEvent(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        kind: 'read',
        status: 'in_progress',
      },
      'session-1',
      '',
    )
    const finished = updateEvent(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        kind: 'read',
        status: 'completed',
        rawOutput: { content: 'Done' },
      },
      'session-1',
      '',
    )
    expect(started.event).toEqual({
      event: 'action_started',
      thread_id: 'session-1',
      action: { id: 'tool-1', title: 'Read file', kind: 'read', status: 'running' },
    })
    expect(finished.event).toEqual({
      event: 'action_completed',
      thread_id: 'session-1',
      action: {
        id: 'tool-1',
        title: 'read',
        kind: 'read',
        status: 'completed',
        output: { content: 'Done' },
      },
    })
  })

  it('detects the active model and reasoning level from session config options', () => {
    const configOptions = [
      {
        type: 'select' as const,
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'claude-sonnet',
        options: [],
      },
      {
        type: 'select' as const,
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'thought_level',
        currentValue: 'high',
        options: [],
      },
    ]
    expect(acpSessionContext(configOptions)).toEqual({
      model: 'claude-sonnet',
      reasoning_effort: 'high',
    })
    expect(updateEvent({ sessionUpdate: 'config_option_update', configOptions }, 'session-1', '').event).toEqual({
      event: 'thread_context_updated',
      thread_id: 'session-1',
      model: 'claude-sonnet',
      reasoning_effort: 'high',
    })
  })

  it('maps SSE MCP headers to the ACP wire schema', () => {
    expect(
      acpMcpServers([
        {
          id: 'mcp-1',
          name: 'issues',
          transport: 'sse',
          url: 'https://mcp.example/sse',
          headers: { Authorization: 'Bearer token' },
          defaultEnabled: true,
        },
      ]),
    ).toEqual([
      {
        type: 'sse',
        name: 'issues',
        url: 'https://mcp.example/sse',
        headers: [{ name: 'Authorization', value: 'Bearer token' }],
      },
    ])
  })
})
