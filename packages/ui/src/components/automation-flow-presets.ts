import type { AutomationThreadAction } from '@vertexade/platform-contracts'
import type { DraftPrompt } from './automation-recipe-condition-editor'

const delivery: DraftPrompt[] = [
  {
    name: 'Understand',
    prompt: 'Inspect the relevant context, confirm the desired outcome, and identify the smallest complete implementation.',
  },
  { name: 'Implement', prompt: 'Implement the outcome completely, including directly affected types, callers, and edge cases.' },
  { name: 'Verify', prompt: 'Run the relevant checks, inspect the complete diff, fix regressions, and summarize the delivered result.' },
]

const review: DraftPrompt[] = [
  { name: 'Review', prompt: 'Review the target deeply and identify concrete correctness, security, and maintainability issues.' },
  { name: 'Validate findings', prompt: 'Validate every finding against the current code and tests. Remove weak or duplicate findings.' },
  { name: 'Final report', prompt: 'Produce the concise final review with priorities, evidence, and recommended next actions.' },
]

export function fullAutomationFlow(action: AutomationThreadAction): DraftPrompt[] {
  return (action === 'review' ? review : delivery).map((phase) => ({ ...phase }))
}
