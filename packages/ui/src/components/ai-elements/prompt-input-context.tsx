'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@vertexade/ui/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@vertexade/ui/components/ui/hover-card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@vertexade/ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@vertexade/ui/components/ui/tooltip'
import { cn } from '@vertexade/ui/lib/utils'
import type { ChatStatus, FileUIPart, SourceDocumentUIPart } from 'ai'
import { CornerDownLeftIcon, ImageIcon, Monitor, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import type {
  ChangeEvent,
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  PropsWithChildren,
  ReactNode,
  RefObject,
} from 'react'
import { Children, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// ============================================================================
// Helpers
// ============================================================================

export const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    // FileReader uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    return new Promise((resolve) => {
      const reader = new FileReader()
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => resolve(reader.result as string)
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const captureScreenshot = async (): Promise<File | null> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return null
  }

  let stream: MediaStream | null = null
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    })

    video.srcObject = stream

    // Video element uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    await new Promise<void>((resolve, reject) => {
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onloadedmetadata = () => resolve()
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onerror = () => reject(new Error('Failed to load screen stream'))
    })

    await video.play()

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    context.drawImage(video, 0, 0, width, height)
    // canvas.toBlob uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) {
      return null
    }

    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '')

    return new File([blob], `screenshot-${timestamp}.png`, {
      lastModified: Date.now(),
      type: 'image/png',
    })
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    video.pause()
    video.srcObject = null
  }
}

// ============================================================================
// Provider Context & Types
// ============================================================================

export interface AttachmentsContext {
  files: (FileUIPart & { id: string })[]
  add: (files: File[] | FileList) => void
  remove: (id: string) => void
  clear: () => void
  openFileDialog: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
}

export interface TextInputContext {
  value: string
  setInput: (v: string) => void
  clear: () => void
}

export interface PromptInputControllerProps {
  textInput: TextInputContext
  attachments: AttachmentsContext
  /** INTERNAL: Allows PromptInput to register its file textInput + "open" callback */
  __registerFileInput: (ref: RefObject<HTMLInputElement | null>, open: () => void) => void
}

const PromptInputController = createContext<PromptInputControllerProps | null>(null)
export const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(null)

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController)
  if (!ctx) {
    throw new Error('Wrap your component inside <PromptInputProvider> to use usePromptInputController().')
  }
  return ctx
}

// Optional variants (do NOT throw). Useful for dual-mode components.
export const useOptionalPromptInputController = () => useContext(PromptInputController)

export const useProviderAttachments = () => {
  const ctx = useContext(ProviderAttachmentsContext)
  if (!ctx) {
    throw new Error('Wrap your component inside <PromptInputProvider> to use useProviderAttachments().')
  }
  return ctx
}

const useOptionalProviderAttachments = () => useContext(ProviderAttachmentsContext)

export type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string
}>

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export const PromptInputProvider = ({ initialInput: initialTextInput = '', children }: PromptInputProviderProps) => {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput)
  const clearInput = useCallback(() => setTextInput(''), [])

  // ----- attachments state (global when wrapped)
  const [attachmentFiles, setAttachmentFiles] = useState<(FileUIPart & { id: string })[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // oxlint-disable-next-line eslint(no-empty-function)
  const openRef = useRef<() => void>(() => {})

  const add = useCallback((files: File[] | FileList) => {
    const incoming = [...files]
    if (incoming.length === 0) {
      return
    }

    setAttachmentFiles((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        filename: file.name,
        id: nanoid(),
        mediaType: file.type,
        type: 'file' as const,
        url: URL.createObjectURL(file),
      })),
    ])
  }, [])

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id)
      if (found?.url) {
        URL.revokeObjectURL(found.url)
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      }
      return []
    })
  }, [])

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles)

  useEffect(() => {
    attachmentsRef.current = attachmentFiles
  }, [attachmentFiles])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(
    () => () => {
      for (const f of attachmentsRef.current) {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      }
    },
    [],
  )

  const openFileDialog = useCallback(() => {
    openRef.current?.()
  }, [])

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef,
      files: attachmentFiles,
      openFileDialog,
      remove,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog],
  )

  const __registerFileInput = useCallback((ref: RefObject<HTMLInputElement | null>, open: () => void) => {
    fileInputRef.current = ref.current
    openRef.current = open
  }, [])

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      __registerFileInput,
      attachments,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [textInput, clearInput, attachments, __registerFileInput],
  )

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>{children}</ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  )
}

// ============================================================================
// Component Context & Hooks
// ============================================================================

export const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null)

export const usePromptInputAttachments = () => {
  // Prefer local context (inside PromptInput) as it has validation, fall back to provider
  const provider = useOptionalProviderAttachments()
  const local = useContext(LocalAttachmentsContext)
  const context = local ?? provider
  if (!context) {
    throw new Error('usePromptInputAttachments must be used within a PromptInput or PromptInputProvider')
  }
  return context
}

// ============================================================================
// Referenced Sources (Local to PromptInput)
// ============================================================================

export interface ReferencedSourcesContext {
  sources: (SourceDocumentUIPart & { id: string })[]
  add: (sources: SourceDocumentUIPart[] | SourceDocumentUIPart) => void
  remove: (id: string) => void
  clear: () => void
}

export const LocalReferencedSourcesContext = createContext<ReferencedSourcesContext | null>(null)

export const usePromptInputReferencedSources = () => {
  const ctx = useContext(LocalReferencedSourcesContext)
  if (!ctx) {
    throw new Error('usePromptInputReferencedSources must be used within a LocalReferencedSourcesContext.Provider')
  }
  return ctx
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string
}

export const PromptInputActionAddAttachments = ({ label = 'Add photos or files', ...props }: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    (e: Event) => {
      e.preventDefault()
      attachments.openFileDialog()
    },
    [attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  )
}

export type PromptInputActionAddScreenshotProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string
}

export const PromptInputActionAddScreenshot = ({ label = 'Take screenshot', onSelect, ...props }: PromptInputActionAddScreenshotProps) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    async (event: Event) => {
      onSelect?.(event)
      if (event.defaultPrevented) {
        return
      }

      try {
        const screenshot = await captureScreenshot()
        if (screenshot) {
          attachments.add([screenshot])
        }
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
          return
        }
        throw error
      }
    },
    [onSelect, attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <Monitor className="mr-2 size-4" />
      {label}
    </DropdownMenuItem>
  )
}
