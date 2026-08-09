import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@vertexade/ui/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border-[color-mix(in_oklab,var(--primary)_82%,black)] bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,.14)_inset,0_1px_2px_rgba(0,0,0,.14)] hover:bg-[color-mix(in_oklab,var(--primary)_88%,black)] active:translate-y-px',
        outline:
          'border-border bg-card/70 text-foreground shadow-[0_1px_0_rgba(255,255,255,.035)_inset] hover:border-[color-mix(in_oklab,var(--border),var(--foreground)_10%)] hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground',
        secondary:
          'border-border/80 bg-secondary text-secondary-foreground shadow-[0_1px_0_rgba(255,255,255,.025)_inset] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost: 'text-foreground/75 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 gap-1.5 px-3 sm:h-8 sm:px-3',
        xs: "h-7 gap-1 rounded-md px-2 text-xs sm:h-6 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-[0.8rem] sm:h-7 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 gap-2 px-4 sm:h-9 sm:px-3.5',
        icon: 'size-9 sm:size-8',
        'icon-xs': "size-7 rounded-md sm:size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-md sm:size-7',
        'icon-lg': 'size-10 sm:size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  loadingText,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    loadingText?: React.ReactNode
  }) {
  const Comp = asChild ? Slot.Root : 'button'
  const content = loading && loadingText !== undefined ? loadingText : children

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      aria-disabled={asChild && (disabled || loading) ? true : undefined}
      disabled={asChild ? undefined : disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && <LoaderCircle data-slot="button-spinner" className="animate-spin" />}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : content}
    </Comp>
  )
}

function IconButton({
  label,
  size = 'icon',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'size'> & {
  label: string
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
}) {
  return <Button aria-label={label} title={props.title || label} size={size} {...props} />
}

export { Button, IconButton, buttonVariants }
