import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { runCommand } from '../process.ts'
import { createSubagentWorkspace, integrateSubagentWorkspace } from './subagent-workspace.ts'

let directory = ''
let parent = ''
let child = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vertexade-subagent-workspace-'))
  parent = join(directory, 'parent')
  child = join(directory, 'child')
  await runCommand('git', ['init', parent])
  await runCommand('git', ['-C', parent, 'config', 'user.name', 'Test'])
  await runCommand('git', ['-C', parent, 'config', 'user.email', 'test@example.test'])
  await writeFile(join(parent, 'cache.ts'), 'export const cache = false\n')
  await runCommand('git', ['-C', parent, 'add', 'cache.ts'])
  await runCommand('git', ['-C', parent, 'commit', '-m', 'initial'])
  await runCommand('git', ['-C', parent, 'worktree', 'add', '-b', 'subagent/test', child])
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('sub-agent workspace integration', () => {
  it('reuses the parent Work-item worktree without creating a branch or snapshot', async () => {
    const result = await createSubagentWorkspace(
      {
        id: 10,
        repo_id: 1,
        work_item_id: 7,
        worktree_path: parent,
        session_cwd: directory,
      },
      {
        repository: () => ({ id: 1, full_name: 'owner/repo', local_path: parent }),
        run: runCommand,
      },
    )

    expect(result).toMatchObject({
      worktree: parent,
      sessionCwd: directory,
      baseGitDir: expect.stringContaining('/parent/.git'),
      baselineSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    })
    expect(result.branchName).toBeTruthy()
  })

  it('acknowledges changes already written to the shared parent worktree', async () => {
    const baselineSha = (await runCommand('git', ['-C', parent, 'rev-parse', 'HEAD'])).trim()
    await writeFile(join(parent, 'cache.ts'), 'export const cache = true\n')
    await writeFile(join(parent, 'cache.test.ts'), 'export const verified = true\n')

    const result = await integrateSubagentWorkspace(
      { id: 10, repo_id: 1, worktree_path: parent },
      { worktree_path: parent, subagent_base_sha: baselineSha },
      { run: runCommand },
    )

    expect(result).toEqual({ applied: true, files: ['cache.test.ts', 'cache.ts'] })
  })

  it('still applies changes from a legacy isolated child without merging its branch', async () => {
    const parentBranch = (await runCommand('git', ['-C', parent, 'branch', '--show-current'])).trim()
    const baselineSha = (await runCommand('git', ['-C', child, 'rev-parse', 'HEAD'])).trim()
    await writeFile(join(child, 'cache.ts'), 'export const cache = true\n')
    await writeFile(join(child, 'cache.test.ts'), 'export const verified = true\n')

    const result = await integrateSubagentWorkspace(
      { id: 10, repo_id: 1, worktree_path: parent },
      { worktree_path: child, subagent_base_sha: baselineSha },
      { run: runCommand },
    )

    expect(result).toEqual({ applied: true, files: ['cache.test.ts', 'cache.ts'] })
    await expect(readFile(join(parent, 'cache.ts'), 'utf8')).resolves.toBe('export const cache = true\n')
    await expect(readFile(join(parent, 'cache.test.ts'), 'utf8')).resolves.toBe('export const verified = true\n')
    await expect(runCommand('git', ['-C', parent, 'branch', '--show-current'])).resolves.toContain(parentBranch)
  })

  it('is a no-op when a legacy child made no changes', async () => {
    const baselineSha = (await runCommand('git', ['-C', child, 'rev-parse', 'HEAD'])).trim()
    await expect(
      integrateSubagentWorkspace(
        { id: 10, repo_id: 1, worktree_path: parent },
        { worktree_path: child, subagent_base_sha: baselineSha },
        { run: runCommand },
      ),
    ).resolves.toEqual({ applied: false, files: [] })
  })
})
