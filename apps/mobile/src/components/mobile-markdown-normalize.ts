export function normalizeMobileMarkdown(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '')
}
