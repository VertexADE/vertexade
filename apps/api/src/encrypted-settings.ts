import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'

function validateEncryptionKey(key: Buffer) {
  if (key.length !== 32) throw new Error('Settings encryption key must contain exactly 32 bytes')
  return key
}

function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException).code
}

export async function readExistingEncryptionKey(path: string) {
  const key = validateEncryptionKey(await readFile(path))
  await chmod(path, 0o600)
  return key
}

async function createEncryptionKey(path: string, key: Buffer) {
  try {
    await writeFile(path, key, { mode: 0o600, flag: 'wx' })
    return key
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    return readExistingEncryptionKey(path)
  }
}

export async function ensureEncryptionKey(path: string) {
  try {
    return await readExistingEncryptionKey(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  return createEncryptionKey(path, randomBytes(32))
}

export function encryptSettings(value: unknown, key: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptSettings(payload: string, key: Buffer): unknown {
  const packed = Buffer.from(payload, 'base64')
  if (packed.length < 29) throw new Error('Encrypted settings are invalid')
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12))
  decipher.setAuthTag(packed.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'))
}
