type Run = (command: string, args: string[]) => Promise<string>

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function permissionDenied(error: unknown) {
  return /EACCES|EPERM|permission denied|operation not permitted/i.test(message(error))
}

async function repairOwnership(run: Run, worktree: string) {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid === undefined || gid === undefined) throw new Error('The dashboard process user could not be resolved')
  await run('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--user',
    '0:0',
    '--volume',
    `${worktree}:/worktree`,
    'alpine:3.20',
    'chown',
    '-R',
    `${uid}:${gid}`,
    '/worktree',
  ])
}

export async function withWorktreeOwnershipRepair<T>(run: Run, worktree: string, remove: () => Promise<T>) {
  try {
    return await remove()
  } catch (error) {
    if (!permissionDenied(error)) throw error
    try {
      await repairOwnership(run, worktree)
    } catch (repairError) {
      throw new Error(`${message(error)}; automatic ownership repair failed: ${message(repairError)}`)
    }
    return remove()
  }
}
