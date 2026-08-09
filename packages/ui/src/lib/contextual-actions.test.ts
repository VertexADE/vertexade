import { describe, expect, it } from 'vite-plus/test'
import type { ContextualActionContribution, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import {
  contextualActionIdempotencyKey,
  contextualActionInput,
  contextualActions,
  contextualConfirmationValue,
} from './contextual-actions.ts'

const action = {
  id: 'github.approve-pr',
  capabilityId: 'github.approve',
  label: 'Approve',
  placements: ['pull-request.primary'],
  entityKinds: ['pull-request'],
  inputMapping: { repository: 'repository.full_name', pull_number: 'number', head_sha: 'head_sha' },
  conditions: [
    {
      field: 'draft',
      operator: 'equals',
      value: false,
      disabledReason: 'Draft pull requests cannot be approved',
    },
  ],
  confirmation: { level: 'typed', confirmationField: 'number' },
} satisfies ContextualActionContribution

function module(enabled = true): ModuleCatalogEntry {
  return {
    id: 'github',
    name: 'GitHub',
    version: '1.0.0',
    platformApi: '1',
    kind: 'source-control',
    installed: true,
    enabled,
    installation: { origin: 'bundled', removable: false },
    lifecycle: enabled ? 'ready' : 'disabled',
    contributes: { actions: [{ id: 'github.approve', name: 'Approve' }] },
    ui: { contextualActions: [action] },
  }
}

const entity = {
  kind: 'pull-request',
  key: 'acme/example#42',
  data: { repository: { full_name: 'acme/example' }, number: 42, head_sha: 'abc123', draft: false },
}

describe('contextual actions', () => {
  it('binds nested entity fields into capability input', () => {
    expect(contextualActionInput(action, entity)).toEqual({
      repository: 'acme/example',
      pull_number: 42,
      head_sha: 'abc123',
    })
  })

  it('resolves placement, availability, confirmation, and idempotency', () => {
    const [resolved] = contextualActions([module()], entity, 'pull-request.primary')
    expect(resolved).toMatchObject({ enabled: true, disabledReason: null, moduleId: 'github' })
    expect(contextualConfirmationValue(resolved, entity)).toBe('42')
    expect(contextualActionIdempotencyKey(resolved, entity)).toBe('contextual:github:github.approve-pr:pull-request:acme/example#42:abc123')
  })

  it('retains unavailable actions with a useful reason', () => {
    const draft = { ...entity, data: { ...entity.data, draft: true } }
    expect(contextualActions([module()], draft, 'pull-request.primary')[0]).toMatchObject({
      enabled: false,
      disabledReason: 'Draft pull requests cannot be approved',
    })
    expect(contextualActions([module(false)], entity, 'pull-request.primary')[0]).toMatchObject({
      enabled: false,
      disabledReason: 'GitHub is disabled',
    })
  })
})
