import type {
  ArchitectureDecision,
  ImpactAdrReference,
  ImpactChangedFile,
  ImpactDeliveryEffect,
  ImpactNode,
  ImpactValidationTarget,
  ImpactWarning,
} from '@vertexade/platform-contracts'

type ImpactProject = { key: string; rootPath: string }

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

export function contractKind(path: string): ImpactNode['kind'] | null {
  const normalized = path.toLowerCase()
  if (/(^|\/)(migrations?|schema)(\/|\.|$)/.test(normalized) || /(^|\/)drizzle\//.test(normalized)) return 'database'
  if (
    /(^|\/)(contracts?|openapi|graphql|proto)(\/|\.|$)/.test(normalized) ||
    /(^|\/)src\/(index|public)(\.|\/)/.test(normalized) ||
    /(^|\/)api(\/|\.)/.test(normalized)
  )
    return 'public_contract'
  if (/(^|\/)(package\.json|[^/]*config\.[^/]+|tsconfig[^/]*\.json|pnpm-workspace\.yaml|[^/]*lock[^/]*)$/.test(normalized))
    return 'configuration'
  return null
}

export function deliveryKind(path: string): ImpactDeliveryEffect['kind'] | null {
  const normalized = path.toLowerCase()
  if (normalized.startsWith('.github/workflows/')) return 'workflow'
  if (/(^|\/)(dockerfile|deploy|deployment|helm|k8s|kubernetes|terraform|vercel)(\.|\/|$)/.test(normalized)) return 'deployment'
  return null
}

export function projectForPath<Project extends ImpactProject>(projects: Project[], path: string): Project {
  return (
    [...projects]
      .sort((left, right) => right.rootPath.length - left.rootPath.length)
      .find((project) => !project.rootPath || path === project.rootPath || path.startsWith(`${project.rootPath}/`)) || projects[0]!
  )
}

function pathMatchesBoundary(path: string, boundary: string): boolean {
  const candidate = normalizedPath(path)
  const target = normalizedPath(boundary)
  return candidate === target || candidate.startsWith(`${target}/`) || target.startsWith(`${candidate}/`)
}

function applicableDecisions(file: ImpactChangedFile, affectedPaths: string[], decisions: ArchitectureDecision[]): ImpactAdrReference[] {
  return decisions
    .filter((decision) => decision.status === 'accepted' && decision.rule)
    .filter((decision) =>
      decision.rule!.paths.some((path) =>
        [file.path, file.previousPath, ...affectedPaths].filter(Boolean).some((value) => pathMatchesBoundary(value!, path)),
      ),
    )
    .map((decision) => ({
      id: decision.id,
      title: decision.title,
      reason: decision.rule!.rationale,
      confidence: decision.rule!.confidence,
      citation: decision.citation,
    }))
}

function impactRank(level: ImpactChangedFile['impact']['level']): number {
  return { low: 0, unknown: 1, medium: 2, high: 3 }[level]
}

function boundaryImpactLevel(
  contract: ReturnType<typeof contractKind>,
  delivery: ReturnType<typeof deliveryKind>,
  consumerCount: number,
  affectedProjectCount: number,
): 'low' | 'medium' | 'high' {
  if (['public_contract', 'database'].includes(contract || '') || delivery === 'deployment') return 'high'
  return contract || delivery || consumerCount > 0 || affectedProjectCount > 1 ? 'medium' : 'low'
}

function boundaryImpactReason(
  file: ImpactChangedFile,
  contract: ReturnType<typeof contractKind>,
  delivery: ReturnType<typeof deliveryKind>,
) {
  if (contract === 'public_contract') return `${file.path} changes a public contract`
  if (contract) return `${file.path} changes a ${contract.replaceAll('_', ' ')} boundary`
  if (delivery) return `${file.path} changes ${delivery} behavior`
  return null
}

function baselineFileImpact(file: ImpactChangedFile, consumerCount: number, affectedProjectCount: number) {
  const contract = contractKind(file.path)
  const delivery = deliveryKind(file.path)
  const reasons = [boundaryImpactReason(file, contract, delivery)].filter((reason): reason is string => Boolean(reason))
  if (consumerCount) reasons.push(`${consumerCount} source consumer${consumerCount === 1 ? '' : 's'} depend on this file`)
  return { level: boundaryImpactLevel(contract, delivery, consumerCount, affectedProjectCount), reasons }
}

function changedFileAssessment(
  file: ImpactChangedFile,
  consumers: string[],
  affectedProjectKeys: string[],
  decisions: ArchitectureDecision[],
  incomplete: boolean,
): ImpactChangedFile['impact'] {
  const adrs = applicableDecisions(file, consumers, decisions)
  const baseline = baselineFileImpact(file, consumers.length, affectedProjectKeys.length)
  let level: ImpactChangedFile['impact']['level'] = baseline.level
  const reasons = [...baseline.reasons]
  for (const adr of adrs) {
    const decision = decisions.find((candidate) => candidate.id === adr.id)!
    if (impactRank(decision.rule!.impact) > impactRank(level)) level = decision.rule!.impact
    reasons.push(`${decision.id} applies: ${decision.rule!.rationale}`)
  }
  if (level === 'low' && incomplete) {
    level = 'unknown'
    reasons.push('Repository analysis was incomplete, so isolated impact cannot be proven')
  }
  if (!reasons.length) reasons.push('No downstream consumers or governed architecture boundaries were discovered')
  return { level, reasons, consumerCount: consumers.length, affectedProjectKeys, adrs }
}

export function assessChangedFiles({
  changedFiles,
  projects,
  reach,
  decisions,
  warnings,
}: {
  changedFiles: ImpactChangedFile[]
  projects: ImpactProject[]
  reach: Map<string, Set<string>>
  decisions: ArchitectureDecision[]
  warnings: ImpactWarning[]
}): void {
  const incomplete = warnings.some((warning) => /(?:truncated|unavailable|unreadable)/.test(warning.code))
  for (const file of changedFiles) {
    const consumers = [...(reach.get(file.path) || [])].sort()
    const affectedProjectKeys = [file.projectKey, ...consumers.map((path) => projectForPath(projects, path).key)]
      .filter((key, index, all) => all.indexOf(key) === index)
      .sort()
    file.impact = changedFileAssessment(file, consumers, affectedProjectKeys, decisions, incomplete)
  }
}

export function applyAdrValidationRequirements(
  changedFiles: ImpactChangedFile[],
  decisions: ArchitectureDecision[],
  targets: ImpactValidationTarget[],
  warnings: ImpactWarning[],
): void {
  const applicableIds = new Set(changedFiles.flatMap((file) => file.impact.adrs.map((adr) => adr.id)))
  for (const decision of decisions.filter((candidate) => applicableIds.has(candidate.id) && candidate.rule)) {
    const governedProjects = new Set(
      changedFiles
        .filter((file) => file.impact.adrs.some((adr) => adr.id === decision.id))
        .flatMap((file) => file.impact.affectedProjectKeys),
    )
    for (const kind of decision.rule!.validationKinds) {
      const matching = targets.filter((target) => kind === target.kind && governedProjects.has(target.projectKey))
      if (!matching.length) {
        warnings.push({
          code: 'adr_validation_gap',
          message: `${decision.id} requires ${kind.replaceAll('_', ' ')} validation, but no matching script was discovered`,
          path: decision.citation.path,
        })
        continue
      }
      for (const target of matching) {
        target.adrIds = [...new Set([...target.adrIds, decision.id])].sort()
        target.reason = `${target.reason}; required by ${decision.id}`
      }
    }
  }
}

export function aggregateImpactLevel(changedFiles: ImpactChangedFile[]): ImpactChangedFile['impact']['level'] {
  return changedFiles.reduce<ImpactChangedFile['impact']['level']>(
    (current, file) => (impactRank(file.impact.level) > impactRank(current) ? file.impact.level : current),
    'low',
  )
}
