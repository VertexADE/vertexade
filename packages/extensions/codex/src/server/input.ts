import { existsSync } from 'node:fs'

export function codexTurnInput(prompt: string) {
  const paths = [...prompt.matchAll(/!\[[^\]]*\]\((\/[^)\r\n]+\.(?:png|jpe?g|webp|gif))\)/gi)].map((match) => match[1])
  const images = [...new Set(paths)].filter((path) => existsSync(path)).map((path) => ({ type: 'localImage' as const, path }))
  return [{ type: 'text' as const, text: prompt, text_elements: [] }, ...images]
}
