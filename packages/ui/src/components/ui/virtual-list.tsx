import { useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@vertexade/ui/lib/utils'

export function VirtualList<T>({
  items,
  getItemKey,
  estimateSize,
  renderItem,
  empty,
  className,
  contentClassName,
  overscan = 6,
}: {
  items: T[]
  getItemKey(item: T): string | number
  estimateSize: number
  renderItem(item: T, index: number): ReactNode
  empty?: ReactNode
  className?: string
  contentClassName?: string
  overscan?: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getItemKey(items[index]!),
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan,
  })

  if (!items.length) return empty ?? null

  return (
    <div ref={viewportRef} className={cn('overflow-y-auto', className)}>
      <div className={cn('relative w-full', contentClassName)} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderItem(items[virtualRow.index]!, virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
