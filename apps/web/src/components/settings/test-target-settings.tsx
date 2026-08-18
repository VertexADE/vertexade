import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ImpactValidationKind, TestTarget } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { RepositoryOwnerField } from './settings-shared'

type TargetDraft = {
  id: string
  projectKey: string
  projectLabel: string
  kind: ImpactValidationKind
  label: string
  script: string
  executable: TestTarget['executable']
  args: string
  workingDirectory: string
  artifactPaths: string
  timeoutSeconds: number
  enabled: boolean
}

const emptyDraft: TargetDraft = {
  id: '',
  projectKey: 'project:root',
  projectLabel: 'Repository root',
  kind: 'test',
  label: '',
  script: 'test',
  executable: 'pnpm',
  args: 'test',
  workingDirectory: '.',
  artifactPaths: '',
  timeoutSeconds: 600,
  enabled: true,
}

function draftFromTarget(target: TestTarget): TargetDraft {
  return {
    id: target.id,
    projectKey: target.projectKey,
    projectLabel: target.projectLabel,
    kind: target.kind,
    label: target.label,
    script: target.script,
    executable: target.executable,
    args: target.args.join('\n'),
    workingDirectory: target.workingDirectory,
    artifactPaths: target.artifactPaths.join('\n'),
    timeoutSeconds: Math.round(target.timeoutMs / 1_000),
    enabled: target.enabled,
  }
}

export function TestTargetSettings({ repositories, backendId }: { repositories: Repository[]; backendId: string }) {
  const [repositoryId, setRepositoryId] = useState<number | null>(repositories[0]?.id || null)
  const [targets, setTargets] = useState<TestTarget[]>([])
  const [draft, setDraft] = useState<TargetDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const endpoint = repositoryId ? `/api/repositories/${repositoryId}/test-target-overrides` : null

  useEffect(() => {
    if (!repositories.some((repository) => repository.id === repositoryId)) setRepositoryId(repositories[0]?.id || null)
  }, [repositories, repositoryId])

  const load = useCallback(async () => {
    if (!endpoint) return
    setLoading(true)
    try {
      setTargets((await backendApi<{ targets: TestTarget[] }>(backendId, endpoint)).targets)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backendId, endpoint])

  useEffect(() => {
    setDraft(emptyDraft)
    setEditingId(null)
    void load()
  }, [load])

  const replace = useCallback(
    async (next: TestTarget[]) => {
      if (!endpoint) return
      setLoading(true)
      try {
        const result = await backendApi<{ targets: TestTarget[] }>(backendId, endpoint, {
          method: 'POST',
          body: JSON.stringify({ targets: next }),
        })
        setTargets(result.targets)
        setDraft(emptyDraft)
        setEditingId(null)
        toast.success('Repository validation catalog updated')
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [backendId, endpoint],
  )

  const save = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      if (!repositoryId) return
      const target: TestTarget = {
        id: draft.id,
        repositoryId,
        projectKey: draft.projectKey,
        projectLabel: draft.projectLabel,
        kind: draft.kind,
        label: draft.label,
        script: draft.script,
        executable: draft.executable,
        args: draft.args
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        workingDirectory: draft.workingDirectory,
        timeoutMs: draft.timeoutSeconds * 1_000,
        artifactPaths: draft.artifactPaths
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        source: 'configured',
        confidence: 'high',
        enabled: draft.enabled,
      }
      const next = [...targets.filter((candidate) => candidate.id !== (editingId || target.id)), target]
      void replace(next)
    },
    [draft, editingId, replace, repositoryId, targets],
  )

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical /> Trusted validation targets
        </CardTitle>
        <CardDescription>
          Server-owned executable and argument catalogs used by impact-driven validation. Shell strings are never accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RepositoryOwnerField
          id="validation-repository"
          repositories={repositories}
          value={repositoryId}
          description="Overrides are stored on the server that owns the repository."
          onChange={setRepositoryId}
        />
        <div className="divide-y rounded-md border">
          {targets.map((target) => (
            <div key={target.id} className="flex min-w-0 items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{target.label}</strong>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {target.executable} {target.args.join(' ')} · {target.workingDirectory}
                </span>
              </div>
              <Badge variant={target.enabled ? 'outline' : 'secondary'}>{target.enabled ? target.kind : 'disabled'}</Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${target.label}`}
                onClick={() => {
                  setEditingId(target.id)
                  setDraft(draftFromTarget(target))
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${target.label}`}
                disabled={loading}
                onClick={() => void replace(targets.filter((candidate) => candidate.id !== target.id))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!targets.length && (
            <Empty className="m-2 min-h-32 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FlaskConical />
                </EmptyMedia>
                <EmptyTitle>No validation overrides</EmptyTitle>
                <EmptyDescription>
                  Deterministic package-script discovery remains advisory until a trusted target is added.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <form className="flex flex-col gap-4 rounded-md border bg-muted/15 p-3" onSubmit={save}>
          <div>
            <strong>{editingId ? 'Edit target' : 'Add target override'}</strong>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Arguments remain a typed array; shell command strings are not accepted.
            </p>
          </div>
          <FieldGroup className="sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="target-id">Stable target ID</FieldLabel>
              <Input
                id="target-id"
                required
                value={draft.id}
                maxLength={300}
                onChange={(event) => setDraft((value) => ({ ...value, id: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-label">Label</FieldLabel>
              <Input
                id="target-label"
                required
                value={draft.label}
                maxLength={300}
                onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-project-key">Project key</FieldLabel>
              <Input
                id="target-project-key"
                required
                value={draft.projectKey}
                onChange={(event) => setDraft((value) => ({ ...value, projectKey: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-project-label">Project label</FieldLabel>
              <Input
                id="target-project-label"
                required
                value={draft.projectLabel}
                onChange={(event) => setDraft((value) => ({ ...value, projectLabel: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-kind">Validation kind</FieldLabel>
              <Select
                value={draft.kind}
                onValueChange={(value) => setDraft((current) => ({ ...current, kind: value as ImpactValidationKind }))}
              >
                <SelectTrigger id="target-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {['test', 'typecheck', 'lint', 'build', 'integration', 'end_to_end', 'check'].map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kind.replaceAll('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="target-script">Script label</FieldLabel>
              <Input
                id="target-script"
                required
                value={draft.script}
                onChange={(event) => setDraft((value) => ({ ...value, script: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-executable">Executable</FieldLabel>
              <Select
                value={draft.executable}
                onValueChange={(value) => setDraft((current) => ({ ...current, executable: value as TestTarget['executable'] }))}
              >
                <SelectTrigger id="target-executable" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {['pnpm', 'npm', 'yarn', 'bun', 'node'].map((executable) => (
                      <SelectItem key={executable} value={executable}>
                        {executable}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="target-working-directory">Working directory</FieldLabel>
              <Input
                id="target-working-directory"
                required
                value={draft.workingDirectory}
                onChange={(event) => setDraft((value) => ({ ...value, workingDirectory: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="target-timeout">Timeout seconds</FieldLabel>
              <Input
                id="target-timeout"
                required
                type="number"
                min={1}
                max={1_800}
                value={draft.timeoutSeconds}
                onChange={(event) => setDraft((value) => ({ ...value, timeoutSeconds: Number(event.target.value) }))}
              />
            </Field>
            <Field className="flex grid-cols-[auto_1fr] items-center self-end pb-2">
              <Checkbox
                id="target-enabled"
                checked={draft.enabled}
                onCheckedChange={(checked) => setDraft((value) => ({ ...value, enabled: checked === true }))}
              />
              <FieldLabel htmlFor="target-enabled">Enabled</FieldLabel>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="target-arguments">Argument array</FieldLabel>
              <Textarea
                id="target-arguments"
                required
                value={draft.args}
                onChange={(event) => setDraft((value) => ({ ...value, args: event.target.value }))}
              />
              <FieldDescription>One argument per line.</FieldDescription>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="target-artifacts">Expected artifact paths</FieldLabel>
              <Textarea
                id="target-artifacts"
                placeholder="coverage\nreports/test-results.xml"
                value={draft.artifactPaths}
                onChange={(event) => setDraft((value) => ({ ...value, artifactPaths: event.target.value }))}
              />
              <FieldDescription>Repository-relative, one path per line.</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex justify-end gap-2">
            {editingId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditingId(null)
                  setDraft(emptyDraft)
                }}
              >
                Cancel
              </Button>
            )}
            <Button disabled={loading}>
              {loading ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {editingId ? 'Update target' : 'Add target'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
