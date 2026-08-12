import { describe, expect, it } from 'vite-plus/test'
import type { ImpactAnalysis, TestCatalog } from '@vertexade/platform-contracts'
import { normalizeTestTargetOverride, selectTests } from './test-intelligence.ts'

function analysis(): ImpactAnalysis {
  const now = new Date().toISOString()
  return {
    id: 1,
    executionId: 1,
    subject: { kind: 'repository_comparison', repositoryId: 7, baseRevision: 'a'.repeat(40), headRevision: 'b'.repeat(40) },
    status: 'succeeded',
    freshness: 'current',
    progress: 100,
    resultVersion: 'test',
    digest: 'c'.repeat(64),
    warningCount: 0,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    result: {
      analyzerVersion: 'test',
      repositoryName: 'fixture/repository',
      changedFiles: [
        {
          path: 'packages/a/src/index.ts',
          previousPath: null,
          status: 'modified',
          projectKey: 'package:a',
          impact: {
            level: 'medium',
            reasons: ['Fixture consumer'],
            consumerCount: 1,
            affectedProjectKeys: ['package:a', 'package:b'],
            adrs: [],
          },
        },
      ],
      nodes: [
        { key: 'package:a', kind: 'package', label: 'a', path: 'packages/a', direct: true, confidence: 'high' },
        { key: 'package:b', kind: 'package', label: 'b', path: 'packages/b', direct: false, confidence: 'high' },
      ],
      edges: [],
      validationTargets: [
        {
          id: 'package:a:test',
          projectKey: 'package:a',
          projectLabel: 'a',
          kind: 'test',
          script: 'test',
          reason: 'Directly changed project',
          required: true,
          confidence: 'high',
          adrIds: [],
        },
      ],
      deliveryEffects: [],
      applicableAdrs: [],
      warnings: [],
      summary: {
        directProjects: 1,
        transitiveProjects: 1,
        requiredValidations: 1,
        deliveryEffects: 0,
        contractChanges: 0,
        risk: 'medium',
      },
    },
  }
}

describe('test intelligence', () => {
  it('selects required and transitive-project targets and explains every omission and gap', () => {
    const catalog: TestCatalog = {
      repositoryId: 7,
      revision: 'b'.repeat(40),
      packageManager: 'pnpm',
      targets: [
        normalizeTestTargetOverride(7, {
          id: 'package:a:test',
          projectKey: 'package:a',
          projectLabel: 'a',
          kind: 'test',
          label: 'Test a',
          script: 'test',
          executable: 'pnpm',
          args: ['--dir', 'packages/a', 'test'],
          workingDirectory: '.',
          timeoutMs: 30_000,
          enabled: true,
        }),
        normalizeTestTargetOverride(7, {
          id: 'package:b:typecheck',
          projectKey: 'package:b',
          projectLabel: 'b',
          kind: 'typecheck',
          label: 'Typecheck b',
          script: 'typecheck',
          executable: 'pnpm',
          args: ['--dir', 'packages/b', 'typecheck'],
          workingDirectory: '.',
          timeoutMs: 30_000,
          enabled: false,
        }),
      ],
      warnings: [],
      generatedAt: new Date().toISOString(),
    }
    const selection = selectTests(analysis(), catalog)
    expect(selection.selected.map((target) => target.id)).toEqual(['package:a:test'])
    expect(selection.omissions).toEqual([{ targetId: 'package:b:typecheck', reason: 'Target is disabled by repository configuration' }])
    expect(selection.coverageGaps).toContainEqual(expect.objectContaining({ code: 'project_validation_uncovered', path: 'packages/b' }))
  })

  it('rejects shell executables, traversal, and multiline arguments at the trusted catalog boundary', () => {
    const base = {
      id: 'root:test',
      projectKey: 'project:root',
      projectLabel: 'root',
      kind: 'test',
      label: 'Test',
      script: 'test',
      executable: 'node',
      args: ['--test'],
      workingDirectory: '.',
      timeoutMs: 30_000,
      enabled: true,
    }
    expect(() => normalizeTestTargetOverride(1, { ...base, executable: 'sh' })).toThrow('executable')
    expect(() => normalizeTestTargetOverride(1, { ...base, workingDirectory: '../outside' })).toThrow('repository-relative')
    expect(() => normalizeTestTargetOverride(1, { ...base, artifactPaths: ['../outside'] })).toThrow('repository-relative')
    expect(() => normalizeTestTargetOverride(1, { ...base, args: ['ok\nrm -rf .'] })).toThrow('control lines')
  })
})
