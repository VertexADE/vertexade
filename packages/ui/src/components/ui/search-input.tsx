import * as React from 'react'
import { Search, X } from 'lucide-react'

import { IconButton } from '@vertexade/ui/components/ui/button'
import { Input } from '@vertexade/ui/components/ui/input'
import { cn } from '@vertexade/ui/lib/utils'

function SearchInput({
  containerClassName,
  className,
  density = 'default',
  onClear,
  clearLabel = 'Clear search',
  ...props
}: React.ComponentProps<typeof Input> & {
  containerClassName?: string
  density?: 'compact' | 'default'
  onClear?: () => void
  clearLabel?: string
}) {
  const hasValue = typeof props.value === 'string' && props.value.length > 0
  return (
    <div data-slot="search-input" data-density={density} className={cn('relative min-w-0', containerClassName)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={props['aria-label'] || props.placeholder || 'Search'}
        className={cn(
          'h-11 pl-8 sm:h-9 [&::-webkit-search-cancel-button]:appearance-none',
          onClear && 'pr-10 sm:pr-8',
          density === 'compact' && 'h-10 sm:h-8',
          className,
        )}
        {...props}
      />
      {onClear && hasValue && (
        <IconButton
          type="button"
          label={clearLabel}
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={onClear}
        >
          <X />
        </IconButton>
      )}
    </div>
  )
}

export { SearchInput }
