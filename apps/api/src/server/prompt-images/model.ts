import { basename, join } from 'node:path'

export const MAX_PROMPT_IMAGES = 4
const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PROMPT_IMAGE_REQUEST_BYTES = 28 * 1024 * 1024

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export type PromptImageInput = { filename?: unknown; mediaType?: unknown; url?: unknown }
export type DecodedPromptImage = ReturnType<typeof decodePromptImage>

export function decodePromptImage(input: PromptImageInput, index: number) {
  const mediaType = String(input.mediaType || '')
  const extension = extensions[mediaType]
  if (!extension) throw new Error('Only PNG, JPEG, WebP, and GIF prompt images are supported')
  const match = String(input.url || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/)
  if (!match || match[1] !== mediaType) throw new Error('Prompt image data is invalid')
  if (Math.floor((match[2].length * 3) / 4) > MAX_PROMPT_IMAGE_BYTES) throw new Error('Each prompt image must be 5 MB or smaller')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > MAX_PROMPT_IMAGE_BYTES || !hasImageSignature(buffer, mediaType))
    throw new Error('Prompt image contents do not match their file type')
  return { buffer, extension, mediaType, name: promptImageDisplayName(input.filename, index) }
}

export function promptImageFileName(pathname: string) {
  const value = pathname.match(/^\/api\/prompt-images\/([0-9a-f-]+\.(?:png|jpg|webp|gif))$/i)?.[1]
  return value && basename(value) === value ? value : null
}

export function localizePromptImages(prompt: string, directory: string) {
  return prompt.replace(/\/api\/prompt-images\/([0-9a-f-]+\.(?:png|jpg|webp|gif))/gi, (_match, fileName) => join(directory, fileName))
}

function promptImageDisplayName(value: unknown, index: number) {
  const clean = basename(String(value || `pasted-image-${index + 1}`))
    .replace(/[\[\]()\r\n]/g, '-')
    .trim()
  return clean.slice(0, 100) || `pasted-image-${index + 1}`
}

function hasImageSignature(buffer: Buffer, mediaType: string) {
  if (mediaType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mediaType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mediaType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
  return (
    mediaType === 'image/webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}
