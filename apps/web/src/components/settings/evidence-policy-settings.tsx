import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { PullRequestReadinessPolicy, PullRequestReadinessRule } from '@vertexade/platform-contracts'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { ChoiceItem, ChoiceItemContent, ChoiceItemDescription, ChoiceItemTitle, ChoiceList } from '@vertexade/ui/components/ui/choice-list'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { RepositoryOwnerField } from './settings-shared'

const availableRules: Array<PullRequestReadinessRule & { label: string }> = [
  { entryKey: 'scope.impact', condition: 'always', required: true, label: 'Impact analysis for every change' },
  { entryKey: 'validation.targets', condition: 'always', required: true, label: 'Impact-selected validation passes' },
  { entryKey: 'review.checks', condition: 'always', required: true, label: 'Source-control checks pass' },
  { entryKey: 'review.approval', condition: 'always', required: true, label: 'Required review is approved' },
  { entryKey: 'architecture.context', condition: 'contract_change', required: true, label: 'Architecture context for contract changes' },
  { entryKey: 'architecture.context', condition: 'database_change', required: true, label: 'Architecture context for database changes' },
  { entryKey: 'architecture.context', condition: 'delivery_change', required: true, label: 'Architecture context for delivery changes' },
  { entryKey: 'release.contract', condition: 'contract_change', required: true, label: 'Compatibility evidence for contract changes' },
  { entryKey: 'release.contract', condition: 'database_change', required: true, label: 'Compatibility evidence for database changes' },
  {
    entryKey: 'release.delivery',
    condition: 'delivery_change',
    required: true,
    label: 'Deployment or preview evidence for delivery changes',
  },
]

function ruleIdentity(rule: PullRequestReadinessRule): string {
  return `${rule.entryKey}:${rule.condition}`
}

export function EvidencePolicySettings({ repositories }: { repositories: Repository[] }) {
  const [repositoryId, setRepositoryId] = useState<number | null>(repositories[0]?.id || null)
  const [policy, setPolicy] = useState<PullRequestReadinessPolicy | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!repositoryId && repositories[0]) setRepositoryId(repositories[0].id)
  }, [repositories, repositoryId])

  const load = useCallback(async () => {
    if (!repositoryId) return
    try {
      const value = await api<PullRequestReadinessPolicy>(`/api/repositories/${repositoryId}/evidence-policy`)
      setPolicy(value)
      setSelected(new Set(value.rules.filter((rule) => rule.required).map(ruleIdentity)))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [repositoryId])

  useEffect(() => void load(), [load])

  const save = useCallback(async () => {
    if (!repositoryId) return
    setSaving(true)
    try {
      const value = await api<PullRequestReadinessPolicy>(`/api/repositories/${repositoryId}/evidence-policy`, {
        method: 'POST',
        body: JSON.stringify({ rules: availableRules.filter((rule) => selected.has(ruleIdentity(rule))) }),
      })
      setPolicy(value)
      toast.success(`Readiness policy v${value.version} saved on the repository owner`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }, [repositoryId, selected])

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck /> Pull-request readiness policy
        </CardTitle>
        <CardDescription>
          Missing collectors stay unknown. Conditional proof is activated only when current-head impact detects that change class.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RepositoryOwnerField
          id="evidence-repository"
          repositories={repositories}
          value={repositoryId}
          description="The policy follows the repository owner in a federated workspace."
          onChange={setRepositoryId}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium">Required evidence</legend>
          <ChoiceList scrollable>
            {availableRules.map((rule) => {
              const identity = ruleIdentity(rule)
              const checkboxId = `evidence-rule-${identity.replaceAll('.', '-').replaceAll(':', '-')}`
              return (
                <ChoiceItem key={identity} htmlFor={checkboxId}>
                  <Checkbox
                    id={checkboxId}
                    checked={selected.has(identity)}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(identity)
                        else next.delete(identity)
                        return next
                      })
                    }
                  />
                  <ChoiceItemContent>
                    <ChoiceItemTitle>{rule.label}</ChoiceItemTitle>
                    <ChoiceItemDescription>{rule.condition.replaceAll('_', ' ')}</ChoiceItemDescription>
                  </ChoiceItemContent>
                </ChoiceItem>
              )
            })}
          </ChoiceList>
        </fieldset>
      </CardContent>
      <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground">
          {policy?.repositoryId === null ? 'Using server defaults' : `Repository override v${policy?.version || 1}`}
        </p>
        <Button disabled={saving || !repositoryId} onClick={() => void save()}>
          {saving && <Spinner data-icon="inline-start" />}
          {saving ? 'Saving…' : 'Save policy override'}
        </Button>
      </CardFooter>
    </Card>
  )
}
