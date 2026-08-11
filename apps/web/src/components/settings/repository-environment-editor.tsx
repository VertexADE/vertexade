import { FileKey2, Files, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import {
  nextRowId,
  type EnvironmentProfile,
  type ManagedEnvFile,
  type SecretVariable,
  type SnapshotPath,
} from './repository-environment-types'

const placeholders = [
  '{{domain}}',
  '{{url}}',
  '{{base_domain}}',
  '{{port}}',
  '{{repo}}',
  '{{scope}}',
  '{{service}}',
  '{{worktree}}',
  '{{job_id}}',
]

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Files
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-muted/[.12] p-3">
      <div className="flex gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-xs font-medium">{title}</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-destructive" aria-label={label} onClick={onClick}>
      <Trash2 />
    </Button>
  )
}

function SnapshotEditor({ rows, update }: { rows: SnapshotPath[]; update: (rows: SnapshotPath[]) => void }) {
  return (
    <Section
      icon={Files}
      title="Worktree snapshots"
      description="Copy local, untracked files or folders into every newly created worktree. Paths are relative to this profile’s scope."
    >
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              required
              maxLength={500}
              className="h-8 min-w-0 font-mono text-xs"
              value={row.path}
              placeholder=".env.example.local or config/local"
              onChange={(event) =>
                update(rows.map((entry) => (entry.id === row.id ? { ...entry, path: event.target.value, kind: undefined } : entry)))
              }
            />
            {row.kind && (
              <Badge variant="outline" className="hidden shrink-0 capitalize sm:flex">
                {row.kind}
              </Badge>
            )}
            <RemoveButton
              label={`Remove ${row.path || 'snapshot path'}`}
              onClick={() => update(rows.filter((entry) => entry.id !== row.id))}
            />
          </div>
        ))}
      </div>
      {!rows.length && (
        <p className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
          No local files are copied for this scope.
        </p>
      )}
      <Button type="button" variant="outline" size="xs" onClick={() => update([...rows, { id: nextRowId('snapshot'), path: '' }])}>
        <Plus data-icon="inline-start" />
        Add snapshot
      </Button>
    </Section>
  )
}

function VariableEditor({ rows, update }: { rows: SecretVariable[]; update: (rows: SecretVariable[]) => void }) {
  return (
    <Section
      icon={ShieldCheck}
      title="Encrypted variables"
      description="Values are encrypted at rest and never returned by the API. Deeper profiles override variables with the same name."
    >
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid gap-1.5 rounded-md border bg-background p-2 sm:grid-cols-[minmax(8rem,.7fr)_minmax(10rem,1fr)_auto]"
          >
            <Input
              required
              disabled={row.configured}
              className="h-8 font-mono text-xs"
              value={row.name}
              placeholder="API_TOKEN"
              onChange={(event) => update(rows.map((entry) => (entry.id === row.id ? { ...entry, name: event.target.value } : entry)))}
            />
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 font-mono text-xs"
              value={row.value}
              placeholder={row.configured && !row.changed ? 'Stored securely · type to replace' : 'Value'}
              onChange={(event) =>
                update(rows.map((entry) => (entry.id === row.id ? { ...entry, value: event.target.value, changed: true } : entry)))
              }
            />
            <RemoveButton label={`Remove ${row.name || 'variable'}`} onClick={() => update(rows.filter((entry) => entry.id !== row.id))} />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => update([...rows, { id: nextRowId('variable'), name: '', value: '', configured: false, changed: true }])}
      >
        <Plus data-icon="inline-start" />
        Add variable
      </Button>
    </Section>
  )
}

function EnvFileEditor({ rows, update }: { rows: ManagedEnvFile[]; update: (rows: ManagedEnvFile[]) => void }) {
  return (
    <Section
      icon={FileKey2}
      title="Managed .env files"
      description="Keep familiar .env-formatted groups encrypted. They are parsed and injected into matching containers without writing secrets into the host worktree."
    >
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-1.5 rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <Input
                required
                disabled={row.configured}
                className="h-8 min-w-0 font-mono text-xs"
                value={row.path}
                placeholder=".env or .env.local"
                onChange={(event) => update(rows.map((entry) => (entry.id === row.id ? { ...entry, path: event.target.value } : entry)))}
              />
              <RemoveButton
                label={`Remove ${row.path || '.env file'}`}
                onClick={() => update(rows.filter((entry) => entry.id !== row.id))}
              />
            </div>
            <Textarea
              className="min-h-20 font-mono text-xs"
              value={row.content}
              placeholder={
                row.configured && !row.changed ? 'Stored securely · paste content to replace' : 'DATABASE_URL=…\nFEATURE_FLAG=true'
              }
              onChange={(event) =>
                update(rows.map((entry) => (entry.id === row.id ? { ...entry, content: event.target.value, changed: true } : entry)))
              }
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() =>
          update([
            ...rows,
            {
              id: nextRowId('env-file'),
              path: '.env',
              content: '',
              configured: false,
              changed: true,
            },
          ])
        }
      >
        <Plus data-icon="inline-start" />
        Add .env file
      </Button>
    </Section>
  )
}

function LifecycleEditor({ profile, update }: { profile: EnvironmentProfile; update: (profile: EnvironmentProfile) => void }) {
  return (
    <Section
      icon={Play}
      title="Container lifecycle"
      description="Optional overrides run through sh inside the detected preview container. Stop always tears the container down, even if its command fails."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="environment-start-command">Start command</FieldLabel>
          <Textarea
            id="environment-start-command"
            className="min-h-20 font-mono text-xs"
            value={profile.startCommand}
            placeholder="pnpm dev --host 0.0.0.0"
            onChange={(event) => update({ ...profile, startCommand: event.target.value })}
          />
          <FieldDescription>Runs after the preview container starts.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="environment-stop-command">Stop command</FieldLabel>
          <Textarea
            id="environment-stop-command"
            className="min-h-20 font-mono text-xs"
            value={profile.stopCommand}
            placeholder="pnpm cleanup"
            onChange={(event) => update({ ...profile, stopCommand: event.target.value })}
          />
          <FieldDescription>Runs before the container is torn down.</FieldDescription>
        </Field>
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Runtime placeholders</p>
        <div className="flex flex-wrap gap-1">
          {placeholders.map((token) => (
            <Badge key={token} variant="outline" className="font-mono text-[11px]">
              {token}
            </Badge>
          ))}
        </div>
      </div>
    </Section>
  )
}

export function RepositoryEnvironmentEditor({
  profile,
  update,
}: {
  profile: EnvironmentProfile
  update: (profile: EnvironmentProfile) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <StatusPanel tone="info">
        <Files />
        <StatusPanelContent>
          <StatusPanelTitle>Profile scope</StatusPanelTitle>
          <StatusPanelDescription>
            Use an empty subfolder for repository defaults, or target one detected service directory.
          </StatusPanelDescription>
        </StatusPanelContent>
      </StatusPanel>
      <div className="grid gap-2 rounded-lg border bg-muted/[.12] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="environment-scope">Repository subfolder</FieldLabel>
          <Input
            id="environment-scope"
            required={Boolean(profile.scope)}
            disabled={profile.persisted}
            className="h-8 font-mono text-xs"
            value={profile.scope}
            placeholder="Repository defaults"
            onChange={(event) => update({ ...profile, scope: event.target.value })}
          />
        </Field>
        <div className="text-[11px] text-muted-foreground">
          {profile.scope ? (
            <>
              Inherits{' '}
              <strong className="text-foreground">
                {profile.inheritsFrom.length ? profile.inheritsFrom.map((scope) => scope || 'defaults').join(' → ') : 'repository defaults'}
              </strong>
            </>
          ) : (
            'Applies to every detected service'
          )}
        </div>
      </div>
      <SnapshotEditor rows={profile.snapshotPaths} update={(snapshotPaths) => update({ ...profile, snapshotPaths })} />
      <VariableEditor rows={profile.variables} update={(variables) => update({ ...profile, variables })} />
      <EnvFileEditor rows={profile.envFiles} update={(envFiles) => update({ ...profile, envFiles })} />
      <LifecycleEditor profile={profile} update={update} />
    </div>
  )
}
