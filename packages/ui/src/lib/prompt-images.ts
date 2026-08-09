import { api } from './dashboard-api'

export const PROMPT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const PROMPT_IMAGE_MAX_FILES = 4
export const PROMPT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type PromptImageFile = { filename?: string; mediaType?: string; url: string }
export type StoredPromptImage = { name: string; url: string }

export async function uploadPromptImages(files: PromptImageFile[]) {
  if (!files.length) return []
  const result = await api<{ images: StoredPromptImage[] }>('/api/prompt-images', {
    method: 'POST',
    body: JSON.stringify({ files }),
  })
  return result.images
}

export async function embedPromptImages(text: string, files: PromptImageFile[]) {
  return appendPromptImages(text, await uploadPromptImages(files))
}

export function appendPromptImages(text: string, images: StoredPromptImage[]) {
  if (!images.length) return text.trim()
  const markdown = images.map((image) => `![${escapeAlt(image.name)}](${image.url})`).join('\n')
  const prefix = text.includes('Attached reference images:') ? markdown : `Attached reference images:\n${markdown}`
  return [text.trim(), prefix].filter(Boolean).join('\n\n')
}

export function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read image')))
    reader.readAsDataURL(file)
  })
}

function escapeAlt(value: string) {
  return value.replace(/[\[\]\r\n]/g, '-')
}
