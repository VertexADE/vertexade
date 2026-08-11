import { useEffect, useMemo, useState } from 'react'
import { FolderCog, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { RepositoryEnvironmentEditor } from './repository-environment-editor'
import {
  editableProfile,
  emptyProfile,
  profilePayload,
  type EnvironmentProfile,
  type EnvironmentProfileResponse,
} from './repository-environment-types'

function sortedProfiles(profiles: EnvironmentProfile[]) {
  return [...profiles].sort(
    (left, right) => Number(Boolean(left.scope)) - Number(Boolean(right.scope)) || left.scope.localeCompare(right.scope),
  )
}

function profileLabel(profile: EnvironmentProfile) {
  return profile.scope || 'Repository defaults'
}

// fallow-ignore-next-line complexity -- Dialog state coordinates loading, selection, and atomic saves; all field editors are delegated.
export function RepositoryEnvironmentDialog({
  repository,
  onOpenChange,
}: {
  repository: Repository | null
  onOpenChange: (open: boolean) => void
}) {
  const [profiles, setProfiles] = useState<EnvironmentProfile[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const selected = useMemo(() => profiles.find((profile) => profile.id === selectedId) || profiles[0], [profiles, selectedId])

  useEffect(() => {
    if (!repository) return
    let active = true
    setLoading(true)
    api<{ profiles: EnvironmentProfileResponse[] }>(`/api/repositories/${repository.id}/environment-profiles`)
      .then((result) => {
        if (!active) return
        const loaded = sortedProfiles(result.profiles.map(editableProfile))
        const next = loaded.some((profile) => !profile.scope) ? loaded : [emptyProfile('', false), ...loaded]
        setProfiles(next)
        setSelectedId(next[0].id)
      })
      .catch((error) => {
        if (active) toast.error((error as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [repository])

  function update(profile: EnvironmentProfile) {
    setProfiles((current) => current.map((entry) => (entry.id === profile.id ? profile : entry)))
  }

  function addProfile() {
    const profile = emptyProfile()
    profile.inheritsFrom = ['']
    setProfiles((current) => [...current, profile])
    setSelectedId(profile.id)
  }

  function removeSelected() {
    if (!selected) return
    if (selected.scope === '') return
    const next = profiles.filter((profile) => profile.id !== selected.id)
    setProfiles(next)
    setSelectedId(next[0].id)
  }

  // fallow-ignore-next-line complexity -- One save transaction preserves configured secrets and refreshes the selected profile.
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!repository) return
    setBusy(true)
    try {
      const result = await api<{ profiles: EnvironmentProfileResponse[] }>(`/api/repositories/${repository.id}/environment-profiles`, {
        method: 'PUT',
        body: JSON.stringify({ profiles: profiles.map(profilePayload) }),
      })
      const saved = sortedProfiles(result.profiles.map(editableProfile))
      setProfiles(saved)
      setSelectedId(saved.find((profile) => profile.scope === selected?.scope)?.id || saved[0]?.id || '')
      toast.success(`Container environments saved for ${repository.full_name}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(repository)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="mx-0 mt-0 border-b p-4 pr-12 sm:mx-0 sm:mt-0">
            <DialogTitle className="flex items-center gap-2">
              <FolderCog />
              Repository environments
            </DialogTitle>
            <DialogDescription>
              Layer encrypted settings and container commands from repository defaults down to individual subfolders in{' '}
              <span className="font-mono">{repository?.full_name}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 md:grid-cols-[14rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b bg-muted/[.18] md:border-b-0 md:border-r">
              <div className="flex items-center justify-between border-b p-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Profiles</span>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Add subfolder profile" onClick={addProfile}>
                  <Plus />
                </Button>
              </div>
              <ScrollArea className="max-h-36 flex-1 md:max-h-none">
                <div className="flex flex-col gap-1 p-2">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                        selected?.id === profile.id ? 'border-primary/35 bg-primary/10' : 'border-transparent hover:bg-muted',
                      )}
                      onClick={() => setSelectedId(profile.id)}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{profileLabel(profile)}</span>
                      <Badge variant="outline" className="px-1 text-[11px]">
                        {profile.variables.length + profile.envFiles.length}
                      </Badge>
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex flex-col gap-2 border-t p-2">
                <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={addProfile}>
                  <Plus data-icon="inline-start" />
                  Subfolder profile
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-destructive"
                  disabled={!selected?.scope}
                  onClick={removeSelected}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete profile
                </Button>
              </div>
            </aside>
            <ScrollArea className="min-h-0">
              <div className="p-3 sm:p-4">
                {loading ? (
                  <p className="flex items-center justify-center gap-2 p-8 text-center text-xs text-muted-foreground">
                    <Spinner /> Loading environment profiles…
                  </p>
                ) : selected ? (
                  <RepositoryEnvironmentEditor profile={selected} update={update} />
                ) : (
                  <p className="p-8 text-center text-xs text-muted-foreground">Add a profile to get started.</p>
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter className="mx-0 mb-0 border-t bg-background p-3 sm:mx-0 sm:mb-0">
            <div className="mr-auto hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
              <ShieldCheck className="text-success" />
              Secrets remain encrypted; lifecycle commands only run inside preview containers.
            </div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={loading || busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? 'Validating and saving…' : 'Save environments'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
