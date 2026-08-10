import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'

const AES_GCM_IV_BYTES = 12
const AES_GCM_AUTH_TAG_BYTES = 16
const MINIMUM_ENCRYPTED_SETTINGS_BYTES = AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES + 1

function validateEncryptionKey(key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('Settings encryption key must contain exactly 32 bytes')
  return key
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

export async function readExistingEncryptionKey(path: string): Promise<Buffer> {
  const key = validateEncryptionKey(await readFile(path))
  await chmod(path, 0o600)
  return key
}

async function createEncryptionKey(path: string, key: Buffer): Promise<Buffer> {
  try {
    await writeFile(path, key, { mode: 0o600, flag: 'wx' })
    return key
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    return readExistingEncryptionKey(path)
  }
}

export async function ensureEncryptionKey(path: string): Promise<Buffer> {
  try {
    return await readExistingEncryptionKey(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  return createEncryptionKey(path, randomBytes(32))
}

export function encryptSettings(value: unknown, key: Buffer): string {
  const iv = randomBytes(AES_GCM_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', validateEncryptionKey(key), iv, {
    authTagLength: AES_GCM_AUTH_TAG_BYTES,
  })
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptSettings(payload: string, key: Buffer): unknown {
  const packed = Buffer.from(payload, 'base64')
  if (packed.length < MINIMUM_ENCRYPTED_SETTINGS_BYTES) {
    throw new Error('Encrypted settings are invalid')
  }

  const decipher = createDecipheriv('aes-256-gcm', validateEncryptionKey(key), packed.subarray(0, AES_GCM_IV_BYTES), {
    authTagLength: AES_GCM_AUTH_TAG_BYTES,
  })
  decipher.setAuthTag(packed.subarray(AES_GCM_IV_BYTES, AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES))
  const ciphertext = packed.subarray(AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}
