import CryptoJS from 'crypto-js/core'
import SHA256 from 'crypto-js/sha256'

type DashboardHashInput = string | ArrayBuffer | Blob

/**
 * RxDB's default SHA-256 implementation requires Web Crypto, which browsers
 * only expose in secure contexts. Keep the same hexadecimal SHA-256 output
 * while allowing the local dashboard cache to run on trusted HTTP origins.
 */
export async function dashboardHash(input: DashboardHashInput) {
  const value = typeof input === 'string' ? input : bytesToWordArray(new Uint8Array(await arrayBuffer(input)))
  return SHA256(value).toString(CryptoJS.enc.Hex)
}

function arrayBuffer(input: ArrayBuffer | Blob) {
  return input instanceof ArrayBuffer ? Promise.resolve(input) : input.arrayBuffer()
}

function bytesToWordArray(bytes: Uint8Array) {
  const words: number[] = []
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] = (words[index >>> 2] ?? 0) | ((bytes[index] ?? 0) << (24 - (index % 4) * 8))
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length)
}
