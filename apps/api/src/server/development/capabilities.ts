import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import type { ImpactAnalysisService, ResolvedImpactAnalysisInput } from './impact-service.ts'
import type { ArchitectureContextService, ResolvedArchitectureIndexInput } from './architecture-service.ts'
import type { ValidationExecutionInput, ValidationIntelligenceService } from './validation-service.ts'

export const impactAnalysisCapabilityId = 'core.analyze-impact'
export const architectureIndexCapabilityId = 'core.index-architecture'
export const validationCapabilityId = 'core.run-validation'

function inputValue(value: unknown): ResolvedImpactAnalysisInput {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Impact analysis input must be an object')
  return value as ResolvedImpactAnalysisInput
}

export function registerCoreDevelopmentCapabilities(registries: PlatformCapabilityRegistries, impact: ImpactAnalysisService): void {
  registries.forModule('core').queries.register({
    id: impactAnalysisCapabilityId,
    name: 'Analyze repository impact',
    description: 'Build a revision-bound, source-backed impact graph for a repository comparison or pull request.',
    inputSchema: {
      type: 'object',
      required: ['subject'],
      additionalProperties: false,
      properties: {
        subject: {
          type: 'object',
          required: ['kind', 'repositoryId', 'baseRevision', 'headRevision'],
          additionalProperties: true,
          properties: {
            kind: { type: 'string', enum: ['repository_comparison', 'pull_request', 'work_item', 'migration_target'] },
            repositoryId: { type: 'integer', minimum: 1 },
            baseRevision: { type: 'string', minLength: 7, maxLength: 64 },
            headRevision: { type: 'string', minLength: 7, maxLength: 64 },
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['analysisId', 'digest'],
      additionalProperties: false,
      properties: {
        analysisId: { type: 'integer', minimum: 1 },
        digest: { type: 'string', minLength: 64, maxLength: 64 },
      },
    },
    timeoutMs: 120_000,
    async query(rawInput, context) {
      const analysis = await impact.analyze(inputValue(rawInput), context.signal)
      return { analysisId: analysis.id, digest: analysis.digest || '' }
    },
  })
}

function architectureInput(value: unknown): ResolvedArchitectureIndexInput {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Architecture index input must be an object')
  return value as ResolvedArchitectureIndexInput
}

export function registerCoreArchitectureCapabilities(
  registries: PlatformCapabilityRegistries,
  architecture: ArchitectureContextService,
): void {
  registries.forModule('core').queries.register({
    id: architectureIndexCapabilityId,
    name: 'Index repository architecture',
    description: 'Build a revision-bound architecture catalog with source citations and explicit relationship confidence.',
    inputSchema: {
      type: 'object',
      required: ['repositoryId', 'revision'],
      additionalProperties: false,
      properties: {
        repositoryId: { type: 'integer', minimum: 1 },
        revision: { type: 'string', minLength: 7, maxLength: 64 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['indexId', 'digest'],
      additionalProperties: false,
      properties: {
        indexId: { type: 'integer', minimum: 1 },
        digest: { type: 'string', minLength: 64, maxLength: 64 },
      },
    },
    timeoutMs: 120_000,
    async query(rawInput, context) {
      const index = await architecture.index(architectureInput(rawInput), context.signal)
      return { indexId: index.id, digest: index.digest || '' }
    },
  })
}

function validationInput(value: unknown): ValidationExecutionInput {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Validation input must be an object')
  return value as ValidationExecutionInput
}

export function registerCoreValidationCapabilities(
  registries: PlatformCapabilityRegistries,
  validation: ValidationIntelligenceService,
): void {
  registries.forModule('core').actions.register({
    id: validationCapabilityId,
    name: 'Run repository validation',
    description: 'Run one server-owned validation target in a detached worktree at the captured revision.',
    inputSchema: {
      type: 'object',
      required: ['repositoryId', 'impactAnalysisId', 'targetId'],
      additionalProperties: false,
      properties: {
        repositoryId: { type: 'integer', minimum: 1 },
        impactAnalysisId: { type: 'integer', minimum: 1 },
        targetId: { type: 'string', minLength: 1, maxLength: 300 },
        parentRunId: { type: 'integer', minimum: 1 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['runId', 'digest', 'status'],
      additionalProperties: false,
      properties: {
        runId: { type: 'integer', minimum: 1 },
        digest: { type: 'string', minLength: 64, maxLength: 64 },
        status: { type: 'string', enum: ['passed', 'failed', 'cancelled', 'timed-out'] },
      },
    },
    timeoutMs: 60 * 60_000,
    retry: { attempts: 1 },
    async execute(rawInput, context) {
      const run = await validation.runTarget(validationInput(rawInput), context.signal)
      return { runId: run.id, digest: run.digest || ''.padStart(64, '0'), status: run.status }
    },
  })
}
