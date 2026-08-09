import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { jobs, repositories } from '../../database/schema/tables.ts'
import { jobRecord } from '../../database/contract-records.ts'
import { parseAgentLogEvents } from '../../agent-timeline.ts'
import { createDiffPreview, storedDiffSummary } from '../../diff-preview.ts'
import { readFileTail, readLogEventContext, resolveReadableLogPath } from '../../log-files.ts'
import {
  runtimeLOGS as LOGS,
  runtimeAgent as agent,
  runtimeAgents as agents,
  runtimeDb as db,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJobLogStatement as jobLogStatement,
  runtimeJson as json,
  runtimeRun as run,
  runtimeScmProvider as scmProvider,
  runtimeStoreJobDiff as storeJobDiff,
  runtimeWithAgentMetadata as withAgentMetadata,
} from '../runtime-context.ts'
import { matchThreadRoute, rejectThreadRoute, type MatchedThreadRoute, type ThreadRoute } from './support.ts'

const artifactRoutes = [
  { method: 'GET', pattern: /^\/api\/agent-threads\/(\d+)\/file$/, handle: fileArtifact },
  { method: 'GET', pattern: /^\/api\/agent-threads\/(\d+)\/log$/, handle: logArtifact },
  { method: 'GET', pattern: /^\/api\/agent-threads\/(\d+)\/diff$/, handle: diffArtifact },
] satisfies MatchedThreadRoute[]

export const handleThreadArtifactRoutes: ThreadRoute = (request, url) => matchThreadRoute(request, url, artifactRoutes)

async function fileArtifact(_request: Request, url: URL, match: RegExpMatchArray) {
  const job = storedPreviewJob(Number(match[1]))
  if (!job) rejectThreadRoute(404, 'Job not found')
  const requestedPath = requestedFile(url)
  const rootPath = await worktreeRoot(job.worktree_path)
  const requestedFilePath = resolve(rootPath, requestedPath)
  assertWithinWorktree(requestedFilePath, rootPath)
  const content = await requestedContent(url, job.head_sha, rootPath, requestedFilePath)
  assertPreviewableContent(content)
  return json(200, previewResponse(url, requestedPath, content))
}

function storedPreviewJob(jobId: number) {
  const stored = db
    .select({ id: jobs.id, worktreePath: jobs.worktreePath, headSha: jobs.headSha })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .get()
  return stored ? jobRecord(stored) : null
}

function requestedFile(url: URL) {
  const path = String(url.searchParams.get('path') || '').replace(/^\.\//, '')
  if (!path || path.includes('\0')) rejectThreadRoute(400, 'A file path is required')
  return path
}

async function worktreeRoot(path: string) {
  try {
    return await realpath(path)
  } catch {
    rejectThreadRoute(404, 'Worktree was not found')
  }
}

function assertWithinWorktree(path: string, rootPath: string) {
  if (path === rootPath || path.startsWith(`${rootPath}${sep}`)) return
  rejectThreadRoute(403, 'Referenced file is outside this worktree')
}

async function requestedContent(url: URL, headSha: string | null, rootPath: string, requestedFilePath: string) {
  const relativePath = relative(rootPath, requestedFilePath)
  if (url.searchParams.get('revision') === 'base') return baseRevisionContent(headSha, rootPath, relativePath)
  return worktreeContent(rootPath, requestedFilePath)
}

async function baseRevisionContent(headSha: string | null, rootPath: string, relativePath: string) {
  if (!headSha) rejectThreadRoute(409, 'This run has no base revision')
  try {
    return await run('git', ['-C', rootPath, 'show', `${headSha}:${relativePath}`])
  } catch {
    rejectThreadRoute(404, 'Referenced file was not found in the run base revision')
  }
}

async function worktreeContent(rootPath: string, requestedFilePath: string) {
  const filePath = await existingFilePath(requestedFilePath)
  assertWithinWorktree(filePath, rootPath)
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) rejectThreadRoute(400, 'Reference does not point to a file')
  if (fileStat.size > 1_000_000) rejectThreadRoute(413, 'Referenced file is too large to preview')
  return readFile(filePath, 'utf8')
}

async function existingFilePath(path: string) {
  try {
    return await realpath(path)
  } catch {
    rejectThreadRoute(404, 'Referenced file was not found in this worktree')
  }
}

function assertPreviewableContent(content: string) {
  if (Buffer.byteLength(content) > 1_000_000) rejectThreadRoute(413, 'Referenced file is too large to preview')
  if (content.includes('\0')) rejectThreadRoute(415, 'Binary files cannot be previewed')
}

function previewResponse(url: URL, path: string, content: string) {
  const requestedLine = Number(url.searchParams.get('line'))
  const lineCount = content.split('\n').length
  const line = Number.isInteger(requestedLine) ? Math.min(Math.max(requestedLine, 1), lineCount) : 1
  return { path, line, line_count: lineCount, content }
}

async function logArtifact(_request: Request, _url: URL, match: RegExpMatchArray) {
  const job = jobLogStatement.get(Number(match[1]))
  if (!job) rejectThreadRoute(404, 'Job not found')
  const [content, eventContext] = await logContents(job.log_path)
  const runtimeAgent = agents.get(job.agent_id) || agent
  return json(200, {
    ...withAgentMetadata(job),
    content,
    events: parseAgentLogEvents(eventContext, runtimeAgent),
    diff: '',
    diff_summary: storedDiffSummary(job),
    queued_follow_ups: jobFollowUps.list(job.id),
  })
}

async function logContents(path: string) {
  try {
    const readablePath = await resolveReadableLogPath(path, LOGS)
    return await Promise.all([readFileTail(readablePath, 100_000), readLogEventContext(readablePath, 100_000)])
  } catch {
    return ['', ''] as const
  }
}

async function diffArtifact(_request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const stored = db
    .select({ latestDiff: jobs.latestDiff, kind: jobs.kind, prNumber: jobs.prNumber, fullName: repositories.fullName })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(eq(jobs.id, jobId))
    .get()
  if (!stored) rejectThreadRoute(404, 'Job not found')
  let diff = String(stored.latestDiff || '')
  if (stored.kind === 'review' && stored.prNumber > 0) {
    try {
      diff = await scmProvider(stored.fullName).pullRequestDiff({ repository: stored.fullName, number: stored.prNumber })
      if (diff.trim()) storeJobDiff(jobId, diff)
    } catch (error) {
      rejectThreadRoute(502, `Could not load the current pull request diff: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return json(200, createDiffPreview(diff))
}
