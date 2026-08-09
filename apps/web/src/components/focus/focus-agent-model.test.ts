import { describe, expect, it } from 'vite-plus/test'
import { agentDockDefaultSection, buildAgentDockSections, firstInputQuestion } from './focus-agent-model'
import { job } from './focus-test-fixtures'

describe('agent dock', () => {
  it('prefers threads needing input, then active work, then recent threads', () => {
    const waiting = job(1, {
      status: 'running',
      input_questions: '[{"id":"policy","question":"Which conflict policy should win?"}]',
    })
    const active = job(2, { status: 'running' })
    const recent = job(3)
    const sections = buildAgentDockSections([recent, active, waiting])

    expect(sections.input.map((item) => item.id)).toEqual([1])
    expect(sections.active.map((item) => item.id)).toEqual([2])
    expect(sections.recent.map((item) => item.id)).toEqual([3])
    expect(agentDockDefaultSection(sections)).toBe('input')
    expect(firstInputQuestion(waiting)).toBe('Which conflict policy should win?')
  })
})
