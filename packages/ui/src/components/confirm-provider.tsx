import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type PendingConfirmation = ConfirmOptions & {
  resolve: (confirmed: boolean) => void
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const resolverRef = useRef<PendingConfirmation['resolve'] | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false)
        resolverRef.current = resolve
        setPending({ ...options, resolve })
      }),
    [],
  )

  const settle = useCallback(
    (confirmed: boolean) => {
      if (!pending) return
      pending.resolve(confirmed)
      resolverRef.current = null
      setPending(null)
    },
    [pending],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader className="static -mx-4 -mt-4">
            <div className="flex items-start gap-3">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${pending?.destructive ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}
              >
                <AlertTriangle className="size-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle>{pending?.title}</DialogTitle>
                <DialogDescription className="mt-1">{pending?.description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="static -mx-4 -mb-4">
            <Button variant="outline" onClick={() => settle(false)}>
              {pending?.cancelLabel || 'Cancel'}
            </Button>
            <Button variant={pending?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
              {pending?.confirmLabel || 'Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}
