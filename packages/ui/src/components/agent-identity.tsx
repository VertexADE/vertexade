import { Bot, BrainCircuit } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { cn } from '@vertexade/ui/lib/utils'

export type AgentAccent = 'neutral' | 'blue' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'orange' | 'rose'

const accentClasses: Record<AgentAccent, string> = {
  neutral: 'border-slate-500/30 bg-slate-500/12 text-slate-300',
  blue: 'border-blue-500/30 bg-blue-500/12 text-blue-400',
  cyan: 'border-cyan-500/30 bg-cyan-500/12 text-cyan-400',
  violet: 'border-violet-500/30 bg-violet-500/12 text-violet-400',
  emerald: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400',
  amber: 'border-amber-500/30 bg-amber-500/12 text-amber-400',
  orange: 'border-orange-500/30 bg-orange-500/12 text-orange-400',
  rose: 'border-rose-500/30 bg-rose-500/12 text-rose-400',
}

function providerInitials(name: string) {
  return (
    name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'AI'
  )
}

function providerKey(value?: string) {
  return value?.toLowerCase().replace(/[\s_-]+/g, '') || ''
}

export function agentDisplayName(id?: string) {
  const key = providerKey(id)
  if (key.includes('opencode')) return 'OpenCode'
  if (key.includes('claude')) return 'Claude Code'
  if (key.includes('codex') || key.includes('openai')) return 'Codex'
  return (
    id
      ?.split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
      .join(' ') || 'Agent'
  )
}

function OpenAiMark() {
  return (
    <svg data-agent-logo="openai" aria-hidden="true" viewBox="0 0 256 260" className="size-[58%] fill-current">
      <path d="M239.184 106.203a64.72 64.72 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.72 64.72 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.67 64.67 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.77 64.77 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483m-97.56 136.338a48.4 48.4 0 0 1-31.105-11.255l1.535-.87l51.67-29.825a8.6 8.6 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601M37.158 197.93a48.35 48.35 0 0 1-5.781-32.589l1.534.921l51.722 29.826a8.34 8.34 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803M23.549 85.38a48.5 48.5 0 0 1 25.58-21.333v61.39a8.29 8.29 0 0 0 4.195 7.316l62.874 36.272l-21.845 12.636a.82.82 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405zm179.466 41.695l-63.08-36.63L161.73 77.86a.82.82 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.54 8.54 0 0 0-4.4-7.213m21.742-32.69l-1.535-.922l-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.72.72 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391zM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87l-51.67 29.825a8.6 8.6 0 0 0-4.246 7.367zm11.868-25.58L128.067 97.3l28.188 16.218v32.434l-28.086 16.218l-28.188-16.218z" />
    </svg>
  )
}

function OpenCodeMark() {
  return (
    <svg data-agent-logo="opencode" aria-hidden="true" viewBox="0 0 24 24" className="size-[58%] fill-current">
      <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />
    </svg>
  )
}

function ClaudeMark() {
  return (
    <svg data-agent-logo="claude" aria-hidden="true" viewBox="0 0 24 24" className="size-[62%] fill-none stroke-current">
      <path
        strokeLinecap="round"
        strokeWidth="2.2"
        d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7M8.4 3.2l7.2 17.6M3.2 8.4l17.6 7.2M15.6 3.2 8.4 20.8M3.2 15.6l17.6-7.2"
      />
    </svg>
  )
}

function providerAccent(id?: string, name?: string): AgentAccent {
  const keys = [providerKey(id), providerKey(name)]
  if (keys.some((key) => key.includes('claude'))) return 'orange'
  if (keys.some((key) => key.includes('opencode'))) return 'violet'
  if (keys.some((key) => key.includes('codex') || key.includes('openai'))) return 'blue'
  return 'neutral'
}

function ProviderMark({ id, name }: { id?: string; name: string }) {
  const keys = [providerKey(id), providerKey(name)]
  if (keys.some((key) => key.includes('opencode'))) return <OpenCodeMark />
  if (keys.some((key) => key.includes('claude'))) return <ClaudeMark />
  if (keys.some((key) => key.includes('codex') || key.includes('openai'))) return <OpenAiMark />
  return providerInitials(name)
}

export function AgentAvatar({
  id,
  name,
  accent = 'neutral',
  size = 'default',
  className,
}: {
  id?: string
  name: string
  accent?: AgentAccent
  size?: 'xs' | 'sm' | 'default' | 'lg'
  className?: string
}) {
  const resolvedAccent = accent === 'neutral' ? providerAccent(id, name) : accent
  return (
    <span
      title={name}
      className={cn(
        'grid shrink-0 place-items-center rounded-lg border font-mono font-semibold',
        accentClasses[resolvedAccent],
        size === 'xs'
          ? 'size-5 rounded-md text-[9px]'
          : size === 'sm'
            ? 'size-7 text-xs'
            : size === 'lg'
              ? 'size-10 text-xs'
              : 'size-8 text-xs',
        className,
      )}
    >
      <ProviderMark id={id} name={name} />
    </span>
  )
}

function ModelBadge({ model }: { model?: string | null }) {
  if (!model) return null
  return (
    <Badge variant="secondary" className="max-w-48 truncate font-mono text-xs">
      <Bot />
      {model}
    </Badge>
  )
}

function ReasoningBadge({ reasoningEffort }: { reasoningEffort?: string | null }) {
  if (!reasoningEffort) return null
  return (
    <Badge variant="outline" className="font-mono text-xs">
      <BrainCircuit />
      {reasoningEffort}
    </Badge>
  )
}

export function AgentContextBadges({
  model,
  reasoningEffort,
  className,
}: {
  model?: string | null
  reasoningEffort?: string | null
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      <ModelBadge model={model} />
      <ReasoningBadge reasoningEffort={reasoningEffort} />
    </span>
  )
}
