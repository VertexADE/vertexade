import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ApiEffect, tryApiPromise } from '@vertexade/platform-server/effect'
import { Effect } from 'effect'
import type { DecodedPromptImage } from './model.ts'

export function readPromptImage(directory: string, fileName: string): ApiEffect<Buffer> {
  return tryApiPromise(() => readFile(join(directory, fileName)), {
    kind: 'not_found',
    message: 'Prompt image not found',
    status: 404,
    code: 'PROMPT_IMAGE_NOT_FOUND',
    causeMessage: 'ignore',
  })
}

export function storePromptImages(directory: string, images: DecodedPromptImage[]): ApiEffect<Array<{ name: string; url: string }>> {
  const storedFiles: string[] = []
  const store = Effect.gen(function* () {
    const result: Array<{ name: string; url: string }> = []
    for (const image of images) {
      const fileName = `${randomUUID()}.${image.extension}`
      yield* tryApiPromise(() => writeFile(join(directory, fileName), image.buffer, { mode: 0o600 }), {
        kind: 'unexpected',
        message: 'Could not store prompt image',
        status: 500,
        code: 'PROMPT_IMAGE_WRITE_FAILED',
        causeMessage: 'ignore',
      })
      storedFiles.push(fileName)
      result.push({
        name: image.name,
        url: `/api/prompt-images/${fileName}`,
      })
    }
    return result
  })

  return store.pipe(
    Effect.onError(() =>
      Effect.promise(() => Promise.all(storedFiles.map((fileName) => rm(join(directory, fileName), { force: true })))).pipe(Effect.ignore),
    ),
    Effect.withSpan('prompt-images.store'),
  )
}
