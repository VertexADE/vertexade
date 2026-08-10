import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ImpactValidationKind, TestTarget } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

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

export function TestTargetSettings({ repositories }: { repositories: Repository[] }) {
  const [repositoryId, setRepositoryId] = useState<number | null>(repositories[0]?.id || null)
  const [targets, setTargets] = useState<TestTarget[]>([])
  const [draft, setDraft] = useState<TargetDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const endpoint = repositoryId ? `/api/repositories/${repositoryId}/test-target-overrides` : null

  useEffect(() => {
    if (!repositoryId && repositories[0]) setRepositoryId(repositories[0].id)
  }, [repositories, repositoryId])

  const load = useCallback(async () => {
    if (!endpoint) return
    setLoading(true)
    try {
      setTargets((await api<{ targets: TestTarget[] }>(endpoint)).targets)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

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
        const result = await api<{ targets: TestTarget[] }>(endpoint, {
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
    [endpoint],
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical /> Trusted validation targets
        </CardTitle>
        <CardDescription>
          Server-owned executable and argument catalogs used by impact-driven validation. Shell strings are never accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Label className="grid gap-1.5">
          Repository owner
          <Select value={repositoryId ? String(repositoryId) : ''} onValueChange={(value) => setRepositoryId(value ? Number(value) : null)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select repository" />
            </SelectTrigger>
            <SelectContent>
              {repositories.map((repository) => (
                <SelectItem key={repository.id} value={String(repository.id)}>
                  {repository.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
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
            <p className="p-3 text-xs text-muted-foreground">No overrides. Deterministic package-script discovery remains advisory.</p>
          )}
        </div>
        <form className="grid gap-3 rounded-md border p-3 sm:grid-cols-2" onSubmit={save}>
          <strong className="sm:col-span-2">{editingId ? 'Edit target' : 'Add target override'}</strong>
          <Label className="grid gap-1.5">
            Stable target ID
            <Input
              required
              value={draft.id}
              maxLength={300}
              onChange={(event) => setDraft((value) => ({ ...value, id: event.target.value }))}
            />
          </Label>
          <Label className="grid gap-1.5">
            Label
            <Input
              required
              value={draft.label}
              maxLength={300}
              onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))}
            />
          </Label>
          <Label className="grid gap-1.5">
            Project key
            <Input
              required
              value={draft.projectKey}
              onChange={(event) => setDraft((value) => ({ ...value, projectKey: event.target.value }))}
            />
          </Label>
          <Label className="grid gap-1.5">
            Project label
            <Input
              required
              value={draft.projectLabel}
              onChange={(event) => setDraft((value) => ({ ...value, projectLabel: event.target.value }))}
            />
          </Label>
          <Label className="grid gap-1.5">
            Validation kind
            <Select
              value={draft.kind}
              onValueChange={(value) => setDraft((current) => ({ ...current, kind: value as ImpactValidationKind }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['test', 'typecheck', 'lint', 'build', 'integration', 'end_to_end', 'check'].map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1.5">
            Script label
            <Input required value={draft.script} onChange={(event) => setDraft((value) => ({ ...value, script: event.target.value }))} />
          </Label>
          <Label className="grid gap-1.5">
            Executable
            <Select
              value={draft.executable}
              onValueChange={(value) => setDraft((current) => ({ ...current, executable: value as TestTarget['executable'] }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['pnpm', 'npm', 'yarn', 'bun', 'node'].map((executable) => (
                  <SelectItem key={executable} value={executable}>
                    {executable}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1.5">
            Working directory
            <Input
              required
              value={draft.workingDirectory}
              onChange={(event) => setDraft((value) => ({ ...value, workingDirectory: event.target.value }))}
            />
          </Label>
          <Label className="grid gap-1.5">
            Timeout seconds
            <Input
              required
              type="number"
              min={1}
              max={1_800}
              value={draft.timeoutSeconds}
              onChange={(event) => setDraft((value) => ({ ...value, timeoutSeconds: Number(event.target.value) }))}
            />
          </Label>
          <Label className="flex items-center gap-2 self-end pb-2">
            <Checkbox
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft((value) => ({ ...value, enabled: checked === true }))}
            />
            Enabled
          </Label>
          <Label className="grid gap-1.5 sm:col-span-2">
            Argument array · one argument per line
            <Textarea required value={draft.args} onChange={(event) => setDraft((value) => ({ ...value, args: event.target.value }))} />
          </Label>
          <Label className="grid gap-1.5 sm:col-span-2">
            Expected artifact paths · repository-relative, one per line
            <Textarea
              placeholder="coverage\nreports/test-results.xml"
              value={draft.artifactPaths}
              onChange={(event) => setDraft((value) => ({ ...value, artifactPaths: event.target.value }))}
            />
          </Label>
          <div className="flex justify-end gap-2 sm:col-span-2">
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
              <Plus data-icon="inline-start" /> {editingId ? 'Update target' : 'Add target'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
