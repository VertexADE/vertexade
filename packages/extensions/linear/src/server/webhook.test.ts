import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vite-plus/test'
import { handleLinearWebhook, normalizeLinearWebhook } from './webhook.ts'

const now = 1_786_000_000_000
const secret = 'linear-signing-secret'

function signedRequest(payload: Record<string, unknown>, signatureSecret = secret) {
  const body = JSON.stringify(payload)
  return new Request('http://localhost/api/extensions/linear/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': 'delivery-1',
      'linear-signature': createHmac('sha256', signatureSecret).update(body).digest('hex'),
    },
    body,
  })
}

function dependencies() {
  return {
    config: () => ({ webhookSecret: secret, teamIds: ['team-1'] }),
    onChange: vi.fn(),
    now: () => now,
  }
}

describe('Linear webhook adapter', () => {
  it('normalizes issue actions without exposing the provider payload', () => {
    expect(
      normalizeLinearWebhook(
        {
          type: 'Issue',
          action: 'remove',
          data: { id: 'issue-1', teamId: 'team-1', title: 'Sensitive title' },
        },
        ['team-1'],
        'delivery-1',
      ),
    ).toEqual({
      reason: 'linear_issue_deleted',
      issueId: 'issue-1',
      deliveryId: 'delivery-1',
    })
  })

  it('refreshes when an issue moves out of a selected team', () => {
    expect(
      normalizeLinearWebhook(
        {
          type: 'Issue',
          action: 'update',
          data: { id: 'issue-1', teamId: 'team-2' },
          updatedFrom: { teamId: 'team-1' },
        },
        ['team-1'],
        'delivery-1',
      ),
    ).toMatchObject({ reason: 'linear_issue_updated', issueId: 'issue-1' })
  })

  it('invalidates and emits only for a selected-team issue', async () => {
    const effects = dependencies()
    const response = await handleLinearWebhook(
      signedRequest({
        type: 'Issue',
        action: 'update',
        webhookTimestamp: now,
        data: { id: 'issue-1', teamId: 'team-1' },
      }),
      effects,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(effects.onChange).toHaveBeenCalledWith('linear_issue_updated')
  })

  it('acknowledges irrelevant events without refreshing the extension board', async () => {
    const effects = dependencies()
    const response = await handleLinearWebhook(
      signedRequest({
        type: 'Comment',
        action: 'create',
        webhookTimestamp: now,
        data: { id: 'comment-1' },
      }),
      effects,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: true, refreshed: false })
    expect(effects.onChange).not.toHaveBeenCalled()
  })

  it('rejects invalid signatures and stale deliveries without side effects', async () => {
    const invalidEffects = dependencies()
    await expect(
      handleLinearWebhook(
        signedRequest(
          {
            type: 'Issue',
            action: 'update',
            webhookTimestamp: now,
            data: { id: 'issue-1', teamId: 'team-1' },
          },
          'wrong-secret',
        ),
        invalidEffects,
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }))
    expect(invalidEffects.onChange).not.toHaveBeenCalled()

    const staleEffects = dependencies()
    await expect(
      handleLinearWebhook(
        signedRequest({
          type: 'Issue',
          action: 'update',
          webhookTimestamp: now - 60_001,
          data: { id: 'issue-1', teamId: 'team-1' },
        }),
        staleEffects,
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }))
    expect(staleEffects.onChange).not.toHaveBeenCalled()
  })
})
