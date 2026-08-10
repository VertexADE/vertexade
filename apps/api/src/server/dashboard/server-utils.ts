import { join } from 'node:path'
import { readRequestBody } from '@vertexade/platform-server/http'
import { runCommand, runCommandResult, type CommandResult, type RunOptions } from '../process.ts'

let resolveCommand = (command: string) => command

export function configureCommandResolver(resolver: (command: string) => string) {
  resolveCommand = resolver
}

function logSegment(value: string, fallback: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^[._-]+|[._-]+$/g, '') || fallback
  )
}

export function agentLogPath(logsRoot: string, workItem: { key: string }, repository: { full_name: string }, suffix: string) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 17)
  const workItemKey = logSegment(workItem.key, 'work')
  const repositoryName = logSegment(repository.full_name.replaceAll('/', '--'), 'repository')
  return join(logsRoot, `${workItemKey}--${repositoryName}--${logSegment(suffix, 'run')}--${stamp}.log`)
}

export function json(status: number, value: unknown) {
  return Response.json(value, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function body(request: Request, maxBytes = 100_000): Promise<any> {
  const payload = await readRequestBody(request, maxBytes)
  return JSON.parse(payload.toString('utf8') || '{}')
}

export function run(command: string, args: string[], options: any = {}) {
  return runCommand(resolveCommand(command), args, options)
}

export function runResult(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return runCommandResult(resolveCommand(command), args, options)
}
