import type { AutomationView } from '@vertexade/ui/components/automation-recipes'

const automationViews = new Set<AutomationView>(['builder', 'recipes', 'runs', 'executions'])

export function automationView(value: unknown): AutomationView | undefined {
  if (value === 'scheduled' || value === 'schedules') return 'recipes'
  if (automationViews.has(String(value) as AutomationView)) return String(value) as AutomationView
  return undefined
}
