import { describe, expect, it } from 'vite-plus/test'
import {
  aggregateReviewPrompt,
  hardReviewChecks,
  qualityScorecardReviewContract,
  repositoryTopologyReviewContract,
  reviewIntentContract,
} from './review-prompt-contract.ts'

describe('review prompt contract', () => {
  it('requires evidence-based handling of standalone, monorepo, and coordinated repository changes', () => {
    expect(repositoryTopologyReviewContract).toContain('two independent dimensions')
    expect(repositoryTopologyReviewContract).toContain('standalone repository')
    expect(repositoryTopologyReviewContract).toContain('workspace/monorepo')
    expect(repositoryTopologyReviewContract).toContain('coordinated multi-repository change')
    expect(repositoryTopologyReviewContract).toContain('A monorepo may also participate in a multi-repository change')
    expect(repositoryTopologyReviewContract).toContain('affected-project matrix')
    expect(repositoryTopologyReviewContract).toContain('Never claim another repository was checked when it was not')
  })

  it('makes every hard check visible in the validation ledger', () => {
    expect(hardReviewChecks).toContain('1. Scope proof')
    expect(hardReviewChecks).toContain('7. Quality-gate proof')
    expect(hardReviewChecks).toContain('10. Hygiene proof')
    expect(hardReviewChecks).toContain('Pass, Fail, Blocked, or Not applicable')
    expect(hardReviewChecks).toContain('Do not mark a check Pass when only part')
  })

  it('reconstructs the desired outcome before judging implementation', () => {
    expect(reviewIntentContract).toContain('who needs the change')
    expect(reviewIntentContract).toContain('observable success criteria')
    expect(reviewIntentContract).toContain('Needs clarification')
    expect(reviewIntentContract).toContain('Do not invent acceptance criteria')
  })

  it('uses deterministic score bands and severity caps', () => {
    expect(qualityScorecardReviewContract).toContain('1–3 = ⚠️ Below acceptable')
    expect(qualityScorecardReviewContract).toContain('6 = 🥉 Acceptable')
    expect(qualityScorecardReviewContract).toContain('10 = 🚀 Best-in-class / Ready to ship')
    expect(qualityScorecardReviewContract).toContain('P0 or P1 finding caps Overall at 3')
    expect(qualityScorecardReviewContract).toContain('merge-blocking P2 or failed required quality gate caps Overall at 5')
    expect(qualityScorecardReviewContract).toContain('Overall is a reasoned release-readiness judgment')
  })

  it('forces aggregate reviews to revalidate topology and missing checks', () => {
    const prompt = aggregateReviewPrompt('## Codex review\nEvidence')
    expect(prompt).toContain('do not decide by majority vote')
    expect(prompt).toContain('resolve that before scoring')
    expect(prompt).toContain('A missing check stays Blocked or Not available')
    expect(prompt).toContain('## Intended outcome')
    expect(prompt).not.toContain('## Risk assessment')
    expect(prompt).toContain('## Codex review\nEvidence')
  })
})
