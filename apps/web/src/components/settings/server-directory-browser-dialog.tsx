import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Folder, HardDrive, Home, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { InputGroup, InputGroupButton, InputGroupInput } from '@vertexade/ui/components/ui/input-group'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'

type DirectoryListing = {
  path: string
  parent: string | null
  home: string
  entries: Array<{ name: string; path: string }>
  offset: number
  limit: number
  total: number
  has_more: boolean
}

export function ServerDirectoryBrowserDialog({
  open,
  backendId,
  backendName,
  initialPath,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  backendId: string
  backendName: string
  initialPath?: string
  onOpenChange(open: boolean): void
  onSelect(path: string): void
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [path, setPath] = useState(initialPath || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const browse = useCallback(
    async (nextPath?: string, append = false) => {
      setLoading(true)
      setError('')
      try {
        const offset = append ? listing?.entries.length || 0 : 0
        const query = new URLSearchParams({
          offset: String(offset),
          limit: '100',
        })
        if (nextPath?.trim()) query.set('path', nextPath.trim())
        const result = await backendApi<DirectoryListing>(backendId, `/api/system/directories?${query}`)
        setListing((current) => (append && current ? { ...result, entries: [...current.entries, ...result.entries] } : result))
        setPath(result.path)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Directory could not be opened')
      } finally {
        setLoading(false)
      }
    },
    [backendId, listing?.entries.length],
  )

  useEffect(() => {
    if (!open) return
    setListing(null)
    setPath(initialPath || '')
    void browse(initialPath)
  }, [backendId, initialPath, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a folder on {backendName}</DialogTitle>
          <DialogDescription>Starts in the server home folder. You can navigate to any readable directory on the server.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void browse(path)
          }}
        >
          <InputGroup className="min-w-0 flex-1">
            <InputGroupInput
              aria-label="Server directory path"
              className="font-mono"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <InputGroupButton type="submit" aria-label="Open path" disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            </InputGroupButton>
          </InputGroup>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Server home"
            onClick={() => void browse(listing?.home)}
            disabled={!listing || loading}
          >
            <Home />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Parent folder"
            onClick={() => void browse(listing?.parent || undefined)}
            disabled={!listing?.parent || loading}
          >
            <ChevronLeft />
          </Button>
        </form>
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <ScrollArea className="h-[min(52dvh,28rem)] rounded-lg border">
          <div className="p-1">
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void browse(entry.path)}
              >
                <Folder className="size-4 shrink-0 fill-primary/15 text-primary" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
            ))}
            {loading && !listing && (
              <div className="grid h-40 place-items-center">
                <LoaderCircle className="animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && listing && !listing.entries.length && (
              <div className="grid h-40 place-items-center text-xs text-muted-foreground">No subfolders</div>
            )}
            {listing?.has_more && (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 w-full"
                disabled={loading}
                onClick={() => void browse(listing.path, true)}
              >
                {loading && <LoaderCircle className="animate-spin" />} Load more
              </Button>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="items-center sm:justify-between">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <HardDrive className="size-3.5" />
            <span className="truncate font-mono">{listing?.path || path || 'Loading…'}</span>
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!listing || loading}
              onClick={() => {
                if (listing) onSelect(listing.path)
                onOpenChange(false)
              }}
            >
              Choose this folder
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
