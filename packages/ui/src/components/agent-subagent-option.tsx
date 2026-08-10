import { UsersRound } from 'lucide-react'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'

export type SubagentChoice = {
  id: string
  name: string
  supportsSubagents?: boolean
  subagentOrchestration?: 'native' | 'harness' | 'none'
}

export function AgentSubagentOption({
  agent,
  checked,
  onCheckedChange,
}: {
  agent?: SubagentChoice
  checked: boolean
  onCheckedChange(checked: boolean): void
}) {
  if (!agent?.supportsSubagents) return null
  const native = agent.subagentOrchestration === 'native' ? ' Native provider delegation remains available.' : ''
  const description = `VertexADE gives ${agent.name} a supervised tool for one-at-a-time child runs in the shared Work-item worktree across enabled agents and models.${native}`
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/[.12] p-3">
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
      <span className="min-w-0">
        <strong className="flex items-center gap-1.5 text-xs">
          <UsersRound className="size-3.5 text-violet-400" />
          Allow sub-agents
        </strong>
        <small className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{description}</small>
      </span>
    </Label>
  )
}
