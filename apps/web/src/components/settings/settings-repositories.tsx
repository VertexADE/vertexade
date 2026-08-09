import { useState } from 'react'
import { FolderCog, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { age, api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { RepositoryEnvironmentDialog } from './repository-environment-dialog'

export function Repositories({
  repositories,
  onAdd,
}: {
  repositories: Repository[]
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [environmentRepo, setEnvironmentRepo] = useState<Repository | null>(null)
  async function sync(repo: Repository) {
    try {
      const result = await api<{ open_prs: number }>(`/api/repositories/${repo.id}/sync`, {
        method: 'POST',
        body: '{}',
      })
      toast.success(`${repo.full_name}: ${result.open_prs} open PRs`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <>
      <Card className="min-w-0 gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-3 sm:p-4">
          <CardTitle className="font-mono text-sm">Repositories</CardTitle>
          <CardDescription className="hidden sm:block">SSH clones live in ~/repos and are the source for task worktrees.</CardDescription>
        </CardHeader>
        <form onSubmit={onAdd} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b p-3">
          <Input name="repository" required placeholder="owner/repository or GitHub URL" className="h-9 min-w-0" />
          <Button size="sm">
            <Plus />
            Add repository
          </Button>
        </form>
        <CardContent className="p-0">
          {repositories.map((repo, index) => (
            <div key={repo.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b p-3 last:border-0">
              <div className="min-w-0">
                <strong className="block truncate font-mono text-xs">{repo.full_name}</strong>
                <span className="block truncate text-[11px] text-muted-foreground" title={repo.local_path}>
                  {repo.synced_at ? `Synced ${age(repo.synced_at)}` : repo.local_path}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  data-audit-action={index === 0 ? 'settings.repository.environment' : undefined}
                  variant="outline"
                  size="icon-xs"
                  className="sm:w-auto sm:px-2"
                  aria-label={`Configure environment for ${repo.full_name}`}
                  title="Environment"
                  onClick={() => setEnvironmentRepo(repo)}
                >
                  <FolderCog />
                  <span className="hidden sm:inline">Environment</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  className="sm:w-auto sm:px-2"
                  aria-label={`Sync ${repo.full_name}`}
                  title="Sync"
                  onClick={() => sync(repo)}
                >
                  <RefreshCw />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <RepositoryEnvironmentDialog
        repository={environmentRepo}
        onOpenChange={(open) => {
          if (!open) setEnvironmentRepo(null)
        }}
      />
    </>
  )
}
