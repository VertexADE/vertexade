import { describe, expect, it } from 'vite-plus/test'
import { automationPromptSummary } from './automation-prompt'

const prompt = `[Automation flow: Review unified-api PRs]
[Phase 1 of 2: Review]

Review the matching pull request for correctness and regressions.

Trigger context:
{
  "id": "platform:1",
  "subject": "pull-request:281",
  "data": {
    "reason": "pr_status_changed",
    "entity": {
      "number": 281,
      "title": "Serve the rendered invoice PDF",
      "repository": "vertexade/vertexade",
      "merge_state_status": "BLOCKED",
      "description": "A brace inside a string: }"
    }
  }
}

Repository instructions follow here.`

describe('automationPromptSummary', () => {
  it('extracts the human-scale automation context from an injected request', () => {
    expect(automationPromptSummary(prompt)).toEqual({
      flow: 'Review unified-api PRs',
      phase: '1 of 2: Review',
      instruction: 'Review the matching pull request for correctness and regressions.',
      subject: 'pull-request:281',
      reason: 'PR Status Changed',
      repository: 'vertexade/vertexade',
      entityTitle: 'Serve the rendered invoice PDF',
      entityNumber: '281',
      state: 'Blocked',
    })
  })

  it('does not reinterpret ordinary user prose or malformed context', () => {
    expect(automationPromptSummary('Please review this object: {"state":"open"}')).toBeNull()
    expect(automationPromptSummary('[Automation flow: Review]\n[Phase 1: Run]\n\nDo it.')).toBeNull()
    expect(automationPromptSummary('[Automation flow: Review]\n[Phase 1: Run]\n\nDo it.\nTrigger context:\n{nope}')).toBeNull()
  })
})
