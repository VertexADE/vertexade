export type ProviderCapability = {
  id: string
  name?: string
  moduleId?: string
  kind: string
  enabled: boolean
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function score(provider: ProviderCapability, hints: string[]) {
  const identities = [provider.id, provider.moduleId || '', provider.name || ''].map(normalized).filter((value) => value.length >= 3)
  return hints.reduce((total, rawHint) => {
    const hint = normalized(rawHint)
    return total + Math.max(0, ...identities.map((identity) => (hint === identity ? 100 : hint.includes(identity) ? 10 : 0)))
  }, 0)
}

export function registeredProviders(providers: ProviderCapability[]) {
  const kinds = [...new Set(providers.map(({ kind }) => kind))].sort((left, right) => left.localeCompare(right))
  return Object.fromEntries(kinds.map((kind) => [kind, providers.filter((provider) => provider.kind === kind).map(({ id }) => id)]))
}

export function selectContextualProvider(
  providers: ProviderCapability[],
  kind: string,
  context: { explicit?: string; hints?: string[] } = {},
) {
  const candidates = providers.filter((provider) => provider.kind === kind && provider.enabled)
  if (context.explicit) {
    const explicit = candidates.find(({ id }) => id === context.explicit)
    if (!explicit) throw new Error(`Provider ${context.explicit} is not an enabled registered ${kind} provider`)
    return explicit.id
  }
  if (!candidates.length) throw new Error(`No enabled extension is registered for the ${kind} aspect`)
  return candidates
    .map((provider, index) => ({ provider, index, score: score(provider, context.hints || []) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]!.provider.id
}
