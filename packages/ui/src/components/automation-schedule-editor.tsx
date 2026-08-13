import { useState } from 'react'
import type { AutomationSchedule } from '@vertexade/platform-contracts'
import { Check, ChevronsUpDown } from 'lucide-react'
import { RepositoryMultiSelect } from '@vertexade/ui/components/repository-multi-select'
import { Button } from '@vertexade/ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@vertexade/ui/components/ui/command'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

const simpleCron = { hourly: '0 * * * *', daily: '0 9 * * *', weekly: '0 9 * * 1' } as const
const timezones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((timezone) => timezone !== 'UTC')]

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function newAutomationSchedule(): AutomationSchedule {
  return {
    repositoryIds: [],
    executionMode: 'unified',
    branchType: 'chore',
    scheduleMode: 'simple',
    simpleSchedule: 'daily',
    cronExpression: simpleCron.daily,
    timezone: localTimezone(),
    nextRunAt: null,
    agentId: null,
    model: null,
    reasoningEffort: null,
    allowSubagents: false,
  }
}

export function scheduleCadence(schedule: AutomationSchedule) {
  if (schedule.scheduleMode === 'cron') return schedule.cronExpression
  if (schedule.simpleSchedule === 'hourly') return 'Hourly'
  if (schedule.simpleSchedule === 'weekly') return 'Weekly · Monday at 09:00'
  return 'Daily · 09:00'
}

export function AutomationScheduleEditor({
  value,
  repositories,
  onChange,
}: {
  value: AutomationSchedule
  repositories: Array<Pick<Repository, 'id' | 'full_name'>>
  onChange(value: AutomationSchedule): void
}) {
  const update = (change: Partial<AutomationSchedule>) => onChange({ ...value, ...change })
  return (
    <section className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/[.035] p-3">
      <div>
        <strong className="text-xs">2. Timing and scope</strong>
        <p className="text-xs text-muted-foreground">Choose when this automation runs and whether its repositories share one Work item.</p>
      </div>
      <Label className="flex-col items-stretch gap-1">
        <span className="text-xs text-muted-foreground">Execution</span>
        <Select
          value={value.executionMode}
          onValueChange={(executionMode) => update({ executionMode: executionMode as AutomationSchedule['executionMode'] })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unified">One unified Work item</SelectItem>
            <SelectItem value="independent">Independent run per repository</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Label className="min-w-0 flex-col items-stretch gap-1">
          <span className="text-xs text-muted-foreground">Cadence</span>
          <Select value={value.scheduleMode} onValueChange={(scheduleMode) => update({ scheduleMode: scheduleMode as 'simple' | 'cron' })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Preset</SelectItem>
              <SelectItem value="cron">Custom cron</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Label className="min-w-0 flex-col items-stretch gap-1">
          <span className="text-xs text-muted-foreground">Frequency</span>
          {value.scheduleMode === 'simple' ? (
            <Select
              value={value.simpleSchedule || 'daily'}
              onValueChange={(simpleSchedule) =>
                update({
                  simpleSchedule: simpleSchedule as AutomationSchedule['simpleSchedule'],
                  cronExpression: simpleCron[simpleSchedule as keyof typeof simpleCron],
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily at 09:00</SelectItem>
                <SelectItem value="weekly">Weekly · Monday at 09:00</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              required
              value={value.cronExpression}
              onChange={(event) => update({ cronExpression: event.target.value })}
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
          )}
        </Label>
        <Label className="min-w-0 flex-col items-stretch gap-1">
          <span className="text-xs text-muted-foreground">Timezone</span>
          <TimezonePicker value={value.timezone} onChange={(timezone) => update({ timezone })} />
        </Label>
      </div>
      <RepositoryMultiSelect
        repositories={repositories}
        selected={value.repositoryIds}
        emptySelectionLabel="choose at least one"
        maximum={null}
        onChange={(repositoryIds) => update({ repositoryIds })}
      />
      <details className="rounded-md border bg-background/70 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">Run options</summary>
        <div className="mt-3 space-y-3">
          <Label className="max-w-48 flex-col items-stretch gap-1">
            <span className="text-xs text-muted-foreground">Branch prefix</span>
            <Select value={value.branchType} onValueChange={(branchType) => update({ branchType })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['chore', 'feature', 'fix', 'refactor', 'test', 'docs'].map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}/
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        </div>
      </details>
    </section>
  )
}

function TimezonePicker({ value, onChange }: { value: string; onChange(timezone: string): void }) {
  const [open, setOpen] = useState(false)
  const options = timezones.includes(value) ? timezones : [value, ...timezones]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Automation timezone"
          className="w-full justify-between overflow-hidden font-normal"
        >
          <span className="truncate">{value}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {options.map((timezone) => (
                <CommandItem
                  key={timezone}
                  value={timezone}
                  onSelect={() => {
                    onChange(timezone)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === timezone ? 'opacity-100' : 'opacity-0')} />
                  <span>{timezone}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
