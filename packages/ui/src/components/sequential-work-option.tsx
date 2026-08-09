import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'

export function SequentialWorkOption({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <Label className="flex items-start gap-2 rounded-lg border border-blue-500/25 bg-blue-500/[.04] p-3">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
      <span>
        <strong className="block text-xs">Split into ordered sub-work items</strong>
        <small className="text-xs leading-relaxed text-muted-foreground">
          Save this on the Work item. Its agent proposes a dependency-aware sequence, pauses for your approval, then implements one approved
          sub-item at a time.
        </small>
      </span>
    </Label>
  )
}
