import { toast } from 'sonner'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

type RepositoryOption = Pick<Repository, 'id' | 'full_name'>

export function RepositoryMultiSelect({
  repositories,
  selected,
  onChange,
  emptyMessage = 'Add repositories in Settings first.',
  emptySelectionLabel = 'link later',
  maximum = 8,
}: {
  repositories: RepositoryOption[]
  selected: number[]
  onChange: (repositoryIds: number[]) => void
  emptyMessage?: string
  emptySelectionLabel?: string
  maximum?: number | null
}) {
  function toggle(repositoryId: number, checked: boolean) {
    if (!checked) return onChange(selected.filter((id) => id !== repositoryId))
    if (selected.includes(repositoryId)) return
    if (maximum !== null && selected.length >= maximum) return toast.error(`Choose no more than ${maximum} repositories`)
    onChange([...selected, repositoryId])
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Repositories · {selected.length || emptySelectionLabel}
      </legend>
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
        {repositories.map((repository) => (
          <Label key={repository.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
            <Checkbox checked={selected.includes(repository.id)} onCheckedChange={(value) => toggle(repository.id, Boolean(value))} />
            <span className="truncate">{repository.full_name}</span>
          </Label>
        ))}
        {!repositories.length && <p className="col-span-full p-3 text-center text-xs text-muted-foreground">{emptyMessage}</p>}
      </div>
      <small className="text-xs text-muted-foreground">
        Each repository gets one reusable Work-item worktree shared by its sequential agent threads.
      </small>
    </fieldset>
  )
}
