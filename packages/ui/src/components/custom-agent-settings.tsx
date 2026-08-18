import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Bot, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { agentLaunchOptions, api, saveAgentLaunchOptions, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'

type Resource = { id: string; name: string }
export type CustomAgentProfile = {
  id: string
  name: string
  description: string
  agentId: string
  model: string
  reasoningEffort: string
  promptPrefix: string
  skillIds: string[]
  mcpServerIds: string[]
}

type ProfileForm = Omit<CustomAgentProfile, 'id'>

function initialForm(profile: CustomAgentProfile | null): ProfileForm {
  if (!profile)
    return {
      name: '',
      description: '',
      promptPrefix: '',
      agentId: '',
      model: '',
      reasoningEffort: '',
      skillIds: [],
      mcpServerIds: [],
    }
  return { ...profile }
}

function profileIdentity(profile: CustomAgentProfile | null) {
  return profile ? { id: profile.id } : {}
}

async function deleteProfile(profile: CustomAgentProfile, request: typeof api) {
  await request(`/api/agent-resources/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' })
}

function resetDeletedProfileSelection(profile: CustomAgentProfile) {
  if (agentLaunchOptions().agentId !== `custom-agent:${profile.id}`) return
  saveAgentLaunchOptions({
    agentId: profile.agentId,
    model: '',
    reasoningEffort: '',
    allowSubagents: false,
  })
}

export function CustomAgentSettings({
  profiles,
  skills,
  mcpServers,
  reload,
  request = api,
}: {
  profiles: CustomAgentProfile[]
  skills: Resource[]
  mcpServers: Resource[]
  reload(): void
  request?: typeof api
}) {
  const confirmAction = useConfirm()
  const [editing, setEditing] = useState<CustomAgentProfile | null>(null)
  function edit(profile: CustomAgentProfile | null) {
    setEditing(profile)
  }
  async function remove(profile: CustomAgentProfile) {
    const confirmed = await confirmAction({
      title: `Delete “${profile.name}”?`,
      description: 'The reusable agent profile is removed. Existing runs keep their recorded configuration.',
      confirmLabel: 'Delete agent',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteProfile(profile, request)
      resetDeletedProfileSelection(profile)
      setEditing((current) => (current?.id === profile.id ? null : current))
      toast.success(`${profile.name} deleted`)
      reload()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4 text-cyan-400" />
          Custom agents
        </CardTitle>
        <CardDescription>
          Build a reusable agent from a native runtime, fixed model and reasoning level, optional prompt, skills, and MCP servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-4 p-4">
        <CustomAgentForm
          key={editing?.id || 'new'}
          profile={editing}
          skills={skills}
          mcpServers={mcpServers}
          request={request}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
          onCancel={() => setEditing(null)}
        />
        <ProfileList profiles={profiles} onEdit={edit} onRemove={remove} />
      </CardContent>
    </Card>
  )
}

function CustomAgentForm({
  profile,
  skills,
  mcpServers,
  request,
  onSaved,
  onCancel,
}: {
  profile: CustomAgentProfile | null
  skills: Resource[]
  mcpServers: Resource[]
  request: typeof api
  onSaved(): void
  onCancel(): void
}) {
  const form = useForm({
    defaultValues: initialForm(profile),
    onSubmit: async ({ value }) => {
      try {
        await request('/api/agent-resources/profiles', {
          method: 'POST',
          body: JSON.stringify({
            ...profileIdentity(profile),
            ...value,
          }),
        })
        form.reset(initialForm(null))
        toast.success(`${value.name} saved`)
        onSaved()
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const values = useStore(form.store, (state) => state.values)
  const options = {
    agentId: values.agentId,
    model: values.model,
    reasoningEffort: values.reasoningEffort,
    allowSubagents: false,
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="space-y-3"
    >
      <FormHeading profile={profile} onCancel={onCancel} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          required
          maxLength={200}
          value={values.name}
          onChange={(event) => form.setFieldValue('name', event.target.value)}
          placeholder="Agent name"
        />
        <Input
          maxLength={2_000}
          value={values.description}
          onChange={(event) => form.setFieldValue('description', event.target.value)}
          placeholder="Short purpose"
        />
      </div>
      <AgentOptionsPicker
        nativeOnly
        showSubagents={false}
        value={options}
        onChange={(value) => {
          form.setFieldValue('agentId', value.agentId)
          form.setFieldValue('model', value.model)
          form.setFieldValue('reasoningEffort', value.reasoningEffort)
        }}
      />
      <Label className="flex-col items-stretch gap-1.5">
        <span>
          Prompt to prepend <small className="text-muted-foreground">· optional</small>
        </span>
        <Textarea
          className="min-h-28"
          maxLength={50_000}
          value={values.promptPrefix}
          onChange={(event) => form.setFieldValue('promptPrefix', event.target.value)}
          placeholder="Stable role, working style, or review focus applied before every turn…"
        />
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <ResourceChecklist
          title="Preset skills"
          items={skills}
          selected={values.skillIds}
          onChange={(skillIds) => form.setFieldValue('skillIds', skillIds)}
        />
        <ResourceChecklist
          title="Preset MCP servers"
          items={mcpServers}
          selected={values.mcpServerIds}
          onChange={(mcpServerIds) => form.setFieldValue('mcpServerIds', mcpServerIds)}
        />
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => <Button disabled={busy || !options.agentId}>{saveLabel(busy, profile)}</Button>}
      </form.Subscribe>
    </form>
  )
}

function FormHeading({ profile, onCancel }: { profile: CustomAgentProfile | null; onCancel(): void }) {
  if (!profile) return <strong className="text-xs">New custom agent</strong>
  return (
    <div className="flex items-center justify-between">
      <strong className="text-xs">Edit {profile.name}</strong>
      <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
        Cancel edit
      </Button>
    </div>
  )
}

function saveLabel(busy: boolean, profile: CustomAgentProfile | null) {
  if (busy) return 'Saving…'
  return profile ? 'Save custom agent' : 'Create custom agent'
}

function ResourceChecklist({
  title,
  items,
  selected,
  onChange,
}: {
  title: string
  items: Resource[]
  selected: string[]
  onChange(value: string[]): void
}) {
  return (
    <fieldset className="space-y-1 rounded-lg border p-2">
      <legend className="px-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">{title}</legend>
      {items.map((item) => (
        <Label key={item.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 hover:bg-accent">
          <Checkbox
            checked={selected.includes(item.id)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...new Set([...selected, item.id])] : selected.filter((id) => id !== item.id))
            }
          />
          <span className="truncate text-xs">{item.name}</span>
        </Label>
      ))}
      {items.length ? null : <p className="px-1 py-2 text-xs text-muted-foreground">Add resources above first.</p>}
    </fieldset>
  )
}

function ProfileList({
  profiles,
  onEdit,
  onRemove,
}: {
  profiles: CustomAgentProfile[]
  onEdit(profile: CustomAgentProfile): void
  onRemove(profile: CustomAgentProfile): void
}) {
  if (!profiles.length)
    return (
      <div className="grid min-h-48 place-items-center rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        Your reusable custom agents will appear here.
      </div>
    )
  return (
    <div className="max-h-[36rem] space-y-2 overflow-y-auto">
      {profiles.map((profile) => (
        <ProfileCard key={profile.id} profile={profile} onEdit={onEdit} onRemove={onRemove} />
      ))}
    </div>
  )
}

function ProfileCard({
  profile,
  onEdit,
  onRemove,
}: {
  profile: CustomAgentProfile
  onEdit(profile: CustomAgentProfile): void
  onRemove(profile: CustomAgentProfile): void
}) {
  return (
    <article className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{profile.name}</strong>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{profileDescription(profile)}</p>
        </div>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Edit ${profile.name}`} onClick={() => onEdit(profile)}>
          <Pencil />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-red-400"
          aria-label={`Delete ${profile.name}`}
          onClick={() => onRemove(profile)}
        >
          <Trash2 />
        </Button>
      </div>
      <ProfileBadges profile={profile} />
    </article>
  )
}

function profileDescription(profile: CustomAgentProfile) {
  return profile.description || 'Reusable custom agent preset'
}

function ProfileBadges({ profile }: { profile: CustomAgentProfile }) {
  const badges = [
    profile.agentId,
    fallbackLabel(profile.model, 'default model'),
    fallbackLabel(profile.reasoningEffort, 'default reasoning'),
    countLabel(profile.skillIds.length, 'skills'),
    countLabel(profile.mcpServerIds.length, 'MCP'),
    presentLabel(profile.promptPrefix, 'Prompt'),
  ].filter(Boolean)
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {badges.map((badge, index) => (
        <Badge key={badge} variant={index ? 'secondary' : 'outline'} className="text-xs">
          {badge}
        </Badge>
      ))}
    </div>
  )
}

function fallbackLabel(value: string, fallback: string) {
  return value || fallback
}
function countLabel(count: number, label: string) {
  return count ? `${count} ${label}` : ''
}
function presentLabel(value: string, label: string) {
  return value ? label : ''
}
