'use client'

import { InputGroupAddon, InputGroupButton } from '@vertexade/ui/components/ui/input-group'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@vertexade/ui/components/ui/tooltip'
import { cn } from '@vertexade/ui/lib/utils'
import type { ChatStatus } from 'ai'
import { CornerDownLeftIcon, SquareIcon, XIcon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { Children, useCallback } from 'react'
export type PromptInputHeaderProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <InputGroupAddon align="block-end" className={cn('order-first flex-wrap gap-1', className)} {...props} />
)

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon align="block-end" className={cn('justify-between gap-1', className)} {...props} />
)

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
)

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode
      shortcut?: string
      side?: ComponentProps<typeof TooltipContent>['side']
    }

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip
}

export const PromptInputButton = ({ variant = 'ghost', className, size, tooltip, ...props }: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? 'sm' : 'icon-sm')

  const button = <InputGroupButton className={cn(className)} size={newSize} type="button" variant={variant} {...props} />

  if (!tooltip) {
    return button
  }

  const tooltipContent = typeof tooltip === 'string' ? tooltip : tooltip.content
  const shortcut = typeof tooltip === 'string' ? undefined : tooltip.shortcut
  const side = typeof tooltip === 'string' ? 'top' : (tooltip.side ?? 'top')

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus
  onStop?: () => void
}

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon-sm',
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === 'submitted' || status === 'streaming'

  let Icon = <CornerDownLeftIcon className="size-4" />

  if (status === 'submitted') {
    Icon = <Spinner />
  } else if (status === 'streaming') {
    Icon = <SquareIcon className="size-4" />
  } else if (status === 'error') {
    Icon = <XIcon className="size-4" />
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault()
        onStop()
        return
      }
      onClick?.(e)
    },
    [isGenerating, onStop, onClick],
  )

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  )
}
