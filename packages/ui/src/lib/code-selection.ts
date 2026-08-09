export type ChatCodeSelection = {
  path: string
  text: string
  startLine: number
  endLine: number
  language?: string
}

export type DiffFileRevision = 'base' | 'current'

const languageAliases: Record<string, string> = {
  cjs: 'javascript',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

export function languageForPath(path: string) {
  const extension = path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()
  return extension ? languageAliases[extension] || '' : ''
}

export function sourcePathForWorktree(path: string, worktreePath: string) {
  const normalized = path.replace(/^\.\//, '')
  const worktreeName = worktreePath.replace(/\/$/, '').split('/').at(-1)
  return worktreeName && normalized.startsWith(`${worktreeName}/`) ? normalized.slice(worktreeName.length + 1) : normalized
}

export function chatPathFromDocumentUri(uri: string) {
  if (!uri.startsWith('file://')) return uri
  try {
    return decodeURIComponent(new URL(uri).pathname).replace(/^\/+/, '')
  } catch {
    return uri.replace(/^file:\/\/+/, '').replace(/^\/+/, '')
  }
}

export function selectedLineRange(selection: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  const startLine = selection.start.line + 1
  const exclusiveTrailingLine = selection.end.line > selection.start.line && selection.end.character === 0
  const endLine = Math.max(startLine, selection.end.line + (exclusiveTrailingLine ? 0 : 1))
  return { startLine, endLine }
}

function codeFence(text: string) {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

export function formatCodeSelectionForChat(selection: ChatCodeSelection) {
  const location =
    selection.startLine === selection.endLine
      ? `${selection.path}:${selection.startLine}`
      : `${selection.path}:${selection.startLine}-${selection.endLine}`
  const fence = codeFence(selection.text)
  const language = selection.language || languageForPath(selection.path)
  return `Code context from \`${location}\`:\n\n${fence}${language}\n${selection.text.trimEnd()}\n${fence}`
}

export function appendCodeSelectionToPrompt(prompt: string, selection: ChatCodeSelection) {
  return [prompt.trimEnd(), formatCodeSelectionForChat(selection)].filter(Boolean).join('\n\n')
}
