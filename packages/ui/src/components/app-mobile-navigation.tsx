import type { LucideIcon } from 'lucide-react'
import { Menu } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@vertexade/ui/components/ui/button'
import { useSidebar } from '@vertexade/ui/components/ui/sidebar'
import { cn } from '@vertexade/ui/lib/utils'

type MobilePath = '/' | '/work' | '/threads' | '/pull-requests'

type MobileNavigationItem = {
  to: string
  label: string
  compactLabel?: string
  icon: LucideIcon
}

function isActive(item: MobileNavigationItem, pathname: string) {
  return item.to === '/' ? pathname === '/' : item.to === pathname || pathname.startsWith(`${item.to}/`)
}

export function MobileMenuButton({ className }: { className?: string }) {
  const { openMobile, setOpenMobile } = useSidebar()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setOpenMobile(true)}
      aria-label="Open workspace menu"
      aria-expanded={openMobile}
    >
      <Menu />
    </Button>
  )
}

export function MobileActionDock({ pathname, items }: { pathname: string; items: MobileNavigationItem[] }) {
  const { openMobile, setOpenMobile } = useSidebar()
  const mobileItems = (['/', '/work', '/threads', '/pull-requests'] as const)
    .map((path) => items.find((item) => item.to === path))
    .filter((item): item is MobileNavigationItem => Boolean(item))
  const menuIsActive = !mobileItems.some((item) => isActive(item, pathname))
  const itemClass =
    'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10px] font-medium text-muted-foreground transition-colors after:absolute after:inset-x-3 after:top-0 after:h-px after:bg-primary after:opacity-0 active:bg-muted/55'

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(3.25rem+env(safe-area-inset-bottom))] items-stretch border-t border-border/55 bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {mobileItems.map((item) => (
        <Link
          key={item.to}
          to={item.to as MobilePath}
          activeOptions={{ exact: item.to === '/' }}
          className={cn(itemClass, isActive(item, pathname) && 'text-primary after:opacity-100')}
        >
          <item.icon className="size-4" />
          <span>{item.compactLabel || item.label}</span>
        </Link>
      ))}
      <button
        type="button"
        className={cn(itemClass, menuIsActive && 'text-primary after:opacity-100')}
        aria-current={menuIsActive ? 'page' : undefined}
        aria-label="Open workspace menu"
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(true)}
      >
        <Menu className="size-4" />
        <span>Menu</span>
      </button>
    </nav>
  )
}
