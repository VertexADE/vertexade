import type { WorkItemSort } from '../lib/work-sort'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const options: Array<{ value: WorkItemSort; label: string }> = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'oldest', label: 'Oldest activity' },
  { value: 'priority-high', label: 'Highest priority' },
  { value: 'priority-low', label: 'Lowest priority' },
  { value: 'created-newest', label: 'Recently created' },
  { value: 'created-oldest', label: 'Oldest created' },
  { value: 'title-asc', label: 'Title · A–Z' },
  { value: 'title-desc', label: 'Title · Z–A' },
  { value: 'status', label: 'Status' },
]

export function WorkSortSelect({ value, onChange }: { value: WorkItemSort; onChange: (value: WorkItemSort) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as WorkItemSort)}>
      <SelectTrigger aria-label="Sort work items" className="col-span-2 w-full sm:col-span-1 sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
