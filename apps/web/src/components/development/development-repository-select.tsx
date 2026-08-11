import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

export function DevelopmentRepositorySelect({
  repositories,
  value,
  onValueChange,
  className = 'w-full',
}: {
  repositories: Repository[]
  value: number | null
  onValueChange(value: number | null): void
  className?: string
}) {
  return (
    <Select value={value ? String(value) : ''} onValueChange={(nextValue) => onValueChange(nextValue ? Number(nextValue) : null)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select repository" />
      </SelectTrigger>
      <SelectContent>
        {repositories.map((repository) => (
          <SelectItem key={repository.id} value={String(repository.id)}>
            {repository.full_name} · {repository.backend_name || 'Local'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
