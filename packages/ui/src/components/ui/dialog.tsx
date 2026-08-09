'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@vertexade/ui/lib/utils'
import { Button } from '@vertexade/ui/components/ui/button'
import { XIcon } from 'lucide-react'

const dialogViewportClassName =
  'pointer-events-none fixed inset-0 z-50 grid min-h-0 place-items-center overflow-y-auto overscroll-contain px-[max(.5rem,env(safe-area-inset-left))] py-[max(.5rem,env(safe-area-inset-top))] [scrollbar-gutter:stable]'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-[#05060a]/72 backdrop-blur-[3px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <div data-slot="dialog-viewport" className={dialogViewportClassName}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'pointer-events-auto relative z-50 my-auto grid max-h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full min-w-0 gap-3 overflow-y-auto overscroll-contain rounded-xl border border-border/90 bg-popover/98 p-3 text-sm text-popover-foreground shadow-[0_24px_80px_rgba(0,0,0,.38)] backdrop-blur-xl duration-150 outline-none [scrollbar-gutter:stable] sm:max-w-lg sm:gap-4 sm:p-4 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-1.5 right-1.5 z-30 sm:top-2 sm:right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'sticky top-0 z-20 -mx-3 -mt-3 flex min-w-0 shrink-0 flex-col gap-1.5 border-b border-border/75 bg-popover p-3 pr-12 sm:-mx-4 sm:-mt-4 sm:gap-2 sm:p-4 sm:pr-14',
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'sticky bottom-0 z-20 -mx-3 -mb-3 mt-auto flex min-w-0 shrink-0 flex-row flex-wrap justify-end gap-2 rounded-b-xl border-t border-border/75 bg-popover p-3 sm:-mx-4 sm:-mb-4 sm:p-4 [&>*]:min-w-0',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('min-w-0 break-words font-heading text-base leading-snug font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'min-w-0 break-words text-xs leading-snug text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogViewportClassName,
}
