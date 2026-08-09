import { useEffect, useRef, useState, type ClipboardEvent, type ComponentProps, type ChangeEvent } from 'react'
import { ImagePlus, Loader2, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  PromptInputButton,
  PromptInputHeader,
  PromptInputSubmit,
  usePromptInputAttachments,
  type PromptInputSubmitProps,
} from '@vertexade/ui/components/ai-elements/prompt-input'
import { Button } from '@vertexade/ui/components/ui/button'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import {
  appendPromptImages,
  fileDataUrl,
  PROMPT_IMAGE_ACCEPT,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_MAX_FILES,
  uploadPromptImages,
  type StoredPromptImage,
} from '@vertexade/ui/lib/prompt-images'
import { cn } from '@vertexade/ui/lib/utils'

export function PromptInputImagePreview() {
  const attachments = usePromptInputAttachments()
  if (!attachments.files.length) return null
  return (
    <PromptInputHeader className="gap-2 border-b bg-muted/20 p-2">
      {attachments.files.map((file) => (
        <div key={file.id} className="group relative size-16 overflow-hidden rounded-lg border bg-background">
          <img src={file.url} alt={file.filename || 'Prompt image'} className="size-full object-cover" />
          <button
            type="button"
            aria-label={`Remove ${file.filename || 'image'}`}
            onClick={() => attachments.remove(file.id)}
            className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/90 opacity-0 shadow-sm transition group-hover:opacity-100 focus:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </PromptInputHeader>
  )
}

export function PromptInputAttachImage() {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton tooltip="Attach images" aria-label="Attach images" onClick={attachments.openFileDialog}>
      <Paperclip />
    </PromptInputButton>
  )
}

type PromptInputImageSubmitProps = Omit<PromptInputSubmitProps, 'disabled' | 'status'> & {
  text: string
  sending: boolean
}

export function PromptInputImageSubmit({ text, sending, ...props }: PromptInputImageSubmitProps) {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputSubmit
      {...props}
      disabled={sending || (!text.trim() && !attachments.files.length)}
      status={sending ? 'submitted' : undefined}
    />
  )
}

type PromptImageTextareaProps = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  onUploadingChange?: (uploading: boolean) => void
}

export function PromptImageTextarea({ value, onValueChange, onUploadingChange, className, disabled, ...props }: PromptImageTextareaProps) {
  const [images, setImages] = useState<StoredPromptImage[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
    setImages((current) => current.filter((image) => value.includes(image.url)))
  }, [value])

  useEffect(() => {
    onUploadingChange?.(uploading)
    return () => onUploadingChange?.(false)
  }, [onUploadingChange, uploading])

  async function addFiles(files: File[]) {
    const accepted = validateFiles(files, images.length)
    if (!accepted.length) return
    setUploading(true)
    try {
      const uploaded = await uploadPromptImages(
        await Promise.all(
          accepted.map(async (file) => ({
            filename: file.name,
            mediaType: file.type,
            url: await fileDataUrl(file),
          })),
        ),
      )
      setImages((current) => [...current, ...uploaded])
      onValueChange(appendPromptImages(valueRef.current, uploaded))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    void addFiles(files)
  }

  function select(event: ChangeEvent<HTMLInputElement>) {
    void addFiles([...(event.target.files || [])])
    event.target.value = ''
  }

  function remove(image: StoredPromptImage) {
    setImages((current) => current.filter((item) => item.url !== image.url))
    onValueChange(
      value
        .replace(`![${image.name}](${image.url})`, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          {...props}
          disabled={disabled || uploading}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onPaste={paste}
          className={cn('pr-10', className)}
        />
        <input ref={fileInput} type="file" className="hidden" accept={PROMPT_IMAGE_ACCEPT} multiple onChange={select} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || uploading || images.length >= PROMPT_IMAGE_MAX_FILES}
          aria-label="Attach images"
          title="Attach images"
          onClick={() => fileInput.current?.click()}
          className="absolute bottom-2 right-2"
        >
          {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        </Button>
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => (
            <div key={image.url} className="group relative size-16 overflow-hidden rounded-lg border bg-muted">
              <img src={image.url} alt={image.name} className="size-full object-cover" />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                onClick={() => remove(image)}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/90 opacity-0 shadow-sm transition group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Paste or attach up to {PROMPT_IMAGE_MAX_FILES} images. They are embedded into the agent prompt.
      </p>
    </div>
  )
}

function validateFiles(files: File[], existing: number) {
  const remaining = PROMPT_IMAGE_MAX_FILES - existing
  const images = files.filter((file) => PROMPT_IMAGE_ACCEPT.split(',').includes(file.type))
  if (images.length !== files.length) toast.error('Only PNG, JPEG, WebP, and GIF images can be attached')
  const sized = images.filter((file) => file.size <= PROMPT_IMAGE_MAX_BYTES)
  if (sized.length !== images.length) toast.error('Each prompt image must be 5 MB or smaller')
  if (sized.length > remaining) toast.error(`A prompt can contain up to ${PROMPT_IMAGE_MAX_FILES} images`)
  return sized.slice(0, Math.max(0, remaining))
}
