import type { AutomationCondition, AutomationRecipe } from '@vertexade/platform-contracts'
import { Bot, CalendarClock, GitPullRequest, Pencil, Play, Power, Sparkles, Trash2 } from 'lucide-react'
import { conditionText } from '@vertexade/ui/components/automation-recipe-editor'
import { scheduleCadence } from '@vertexade/ui/components/automation-schedule-editor'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { VirtualList } from '@vertexade/ui/components/ui/virtual-list'
import { cn } from '@vertexade/ui/lib/utils'

function RecipeCard({
  recipe,
  selected,
  busy,
  triggerName,
  onEdit,
  onRun,
  onToggle,
  onRemove,
}: {
  recipe: AutomationRecipe
  selected: boolean
  busy: string
  triggerName?: string
  onEdit(recipe: AutomationRecipe): void
  onRun(recipe: AutomationRecipe): void
  onToggle(recipe: AutomationRecipe): void
  onRemove(recipe: AutomationRecipe): void
}) {
  return (
    <article className={cn('border-t p-3', selected && 'bg-violet-500/[.045]')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RecipeHeading recipe={recipe} />
          <RecipeSummary recipe={recipe} triggerName={triggerName} />
          <RecipeConditions conditions={recipe.conditions} />
          <RecipeError error={recipe.lastError} />
        </div>
        <RecipeActions recipe={recipe} busy={busy} onEdit={onEdit} onRun={onRun} onToggle={onToggle} onRemove={onRemove} />
      </div>
    </article>
  )
}

function RecipeHeading({ recipe }: { recipe: AutomationRecipe }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <strong className="text-xs">{recipe.name}</strong>
      <Badge variant="outline" className={cn('capitalize', recipeStatusTone(String(recipe.lastStatus)))}>
        {recipeStatus(recipe)}
      </Badge>
      {recipe.threadAction !== 'none' && (
        <Badge variant="secondary" className="gap-1 capitalize">
          {recipe.threadAction === 'review' ? (
            <GitPullRequest className="size-3" />
          ) : recipe.threadAction === 'improve' ? (
            <Sparkles className="size-3" />
          ) : (
            <Bot className="size-3" />
          )}
          {recipe.threadAction} flow
        </Badge>
      )}
      {recipe.schedule && (
        <Badge variant="secondary" className="gap-1">
          <CalendarClock className="size-3" />
          {scheduleCadence(recipe.schedule)}
        </Badge>
      )}
    </div>
  )
}

const recipeStatusTones: Record<string, string> = {
  failed: 'border-red-500/35 text-red-400',
  succeeded: 'border-emerald-500/35 text-emerald-400',
  approval: 'border-violet-500/35 text-violet-300',
  cancelled: 'text-muted-foreground',
}

export function recipeStatusTone(status: string) {
  return recipeStatusTones[status] || ''
}

function recipeStatus(recipe: AutomationRecipe) {
  if (!recipe.enabled) return 'paused'
  return recipe.lastStatus || 'ready'
}

function recipeSource(recipe: AutomationRecipe, triggerName?: string) {
  if (!recipe.triggerId) return 'Manual'
  return `Triggered by ${triggerName || recipe.triggerId}`
}

function recipeFilters(recipe: AutomationRecipe) {
  if (!recipe.conditions.length) return ''
  return ` · ${recipe.conditionMode} ${recipe.conditions.length} filters`
}

function stepSuffix(count: number) {
  return count === 1 ? '' : 's'
}

function RecipeSummary({ recipe, triggerName }: { recipe: AutomationRecipe; triggerName?: string }) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        {recipeSource(recipe, triggerName)} · {recipe.promptSteps.length} prompt phase
        {stepSuffix(recipe.promptSteps.length)} · {recipe.boundActions.length} bound action
        {stepSuffix(recipe.boundActions.length)}
        {recipeFilters(recipe)}
      </p>
      {recipe.promptSteps[0]?.prompt && <p className="mt-1 line-clamp-2 text-xs text-foreground/70">“{recipe.promptSteps[0].prompt}”</p>}
      {recipe.schedule && (
        <p className="mt-1 text-xs text-muted-foreground">
          {recipe.schedule.repositoryIds.length} {recipe.schedule.repositoryIds.length === 1 ? 'repository' : 'repositories'} ·{' '}
          {recipe.schedule.timezone}
          {recipe.schedule.nextRunAt ? ` · Next ${new Date(recipe.schedule.nextRunAt).toLocaleString()}` : ''}
        </p>
      )}
    </>
  )
}

function RecipeConditions({ conditions }: { conditions: AutomationCondition[] }) {
  if (!conditions.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {conditions.map((condition, index) => (
        <Badge key={`${condition.field}:${index}`} variant="secondary" className="max-w-full font-mono text-xs font-normal">
          <span className="truncate">{conditionText(condition)}</span>
        </Badge>
      ))}
    </div>
  )
}

function RecipeError({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mt-1 text-xs text-red-400">{error}</p>
}

function RecipeActions({
  recipe,
  busy,
  onEdit,
  onRun,
  onToggle,
  onRemove,
}: {
  recipe: AutomationRecipe
  busy: string
  onEdit(recipe: AutomationRecipe): void
  onRun(recipe: AutomationRecipe): void
  onToggle(recipe: AutomationRecipe): void
  onRemove(recipe: AutomationRecipe): void
}) {
  const canRunNow = recipe.threadAction === 'none' || Boolean(recipe.schedule)
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        disabled={busy !== ''}
        title="Edit"
        aria-label={`Edit ${recipe.name}`}
        onClick={() => onEdit(recipe)}
      >
        <Pencil />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        disabled={busy !== '' || !canRunNow}
        title={canRunNow ? 'Run now' : 'Run from a matching event'}
        aria-label={`Run ${recipe.name}`}
        onClick={() => onRun(recipe)}
      >
        <Play />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={busy !== ''}
        title={recipe.enabled ? 'Pause' : 'Enable'}
        aria-label={`${recipe.enabled ? 'Pause' : 'Enable'} ${recipe.name}`}
        onClick={() => onToggle(recipe)}
      >
        <Power />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-red-400"
        disabled={busy !== ''}
        title="Delete"
        aria-label={`Delete ${recipe.name}`}
        onClick={() => onRemove(recipe)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export function RecipeList(props: {
  recipes: AutomationRecipe[]
  editingId: number | null
  busy: string
  triggerNames: Record<string, string>
  onEdit(recipe: AutomationRecipe): void
  onRun(recipe: AutomationRecipe): void
  onToggle(recipe: AutomationRecipe): void
  onRemove(recipe: AutomationRecipe): void
}) {
  return (
    <section className="border-b">
      <header className="flex items-center justify-between px-4 py-3">
        <strong className="text-xs">Recipes</strong>
        <Badge variant="secondary">{props.recipes.length}</Badge>
      </header>
      <VirtualList
        items={props.recipes}
        getItemKey={(recipe) => recipe.id}
        estimateSize={112}
        className="max-h-[28rem]"
        empty={<p className="border-t p-8 text-center text-xs text-muted-foreground">No automations yet.</p>}
        renderItem={(recipe) => (
          <RecipeCard
            recipe={recipe}
            selected={props.editingId === recipe.id}
            busy={props.busy}
            triggerName={recipe.triggerId ? props.triggerNames[recipe.triggerId] : undefined}
            onEdit={props.onEdit}
            onRun={props.onRun}
            onToggle={props.onToggle}
            onRemove={props.onRemove}
          />
        )}
      />
    </section>
  )
}
