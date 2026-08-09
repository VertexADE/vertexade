#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { writeSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const dataDirectory = resolve(
  process.env.VERTEXADE_DATA_DIR ||
    (process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(homedir(), '.vertex-ade')),
)
const backupRoot = resolve(process.env.VERTEXADE_BACKUP_DIR || join(root, 'backups'))
const databasePath = join(dataDirectory, 'dashboard.sqlite')
const settingsKeyPath = resolve(process.env.SETTINGS_KEY_PATH || join(dataDirectory, 'settings.key'))
const retentionCount = Number(process.env.VERTEXADE_BACKUP_RETENTION_COUNT || 30)
const backupName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const runFile = promisify(execFile)

function manifestFile(directory, name) {
  if (!name || basename(name) !== name) throw new Error(`Backup manifest contains an unsafe file name: ${String(name)}`)
  return join(directory, name)
}

// fallow-ignore-next-line complexity -- bounded manifest selection is covered by restore-drill tests
function settingsKeyName(manifest) {
  const configured = basename(String(manifest.source?.settingsKey || 'settings.key'))
  const candidates = manifest.files.map((file) => file.name).filter((name) => name !== 'dashboard.sqlite' && name !== 'deployment.json')
  if (candidates.includes(configured)) return configured
  if (candidates.length === 1) return candidates[0]
  throw new Error('Backup manifest does not identify exactly one settings key')
}

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function verify(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  for (const file of manifest.files) {
    const path = manifestFile(directory, file.name)
    if ((await digest(path)) !== file.sha256) throw new Error(`${file.name} does not match its backup checksum`)
  }
  const database = new DatabaseSync(join(directory, 'dashboard.sqlite'), { readOnly: true })
  try {
    const integrity = database
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => Object.values(row)[0])
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity.join(', ')}`)
    database.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all()
  } finally {
    database.close()
  }
  writeSync(1, `Verified backup ${directory}\n`)
  return manifest
}

async function restoreDrill(directory) {
  const manifest = await verify(directory)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vertexade-restore-drill-'))
  try {
    const restoredDatabase = join(temporaryDirectory, 'dashboard.sqlite')
    const restoredKey = join(temporaryDirectory, 'settings.key')
    await copyFile(join(directory, 'dashboard.sqlite'), restoredDatabase)
    await copyFile(manifestFile(directory, settingsKeyName(manifest)), restoredKey)
    await Promise.all([chmod(temporaryDirectory, 0o700), chmod(restoredDatabase, 0o600), chmod(restoredKey, 0o600)])
    const readinessScript = join(root, 'scripts', 'restore-readiness.ts')
    const readinessResult = join(temporaryDirectory, 'readiness.json')
    await runFile(process.execPath, ['--import', 'tsx', readinessScript, restoredDatabase, restoredKey, readinessResult], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    })
    const readiness = JSON.parse(await readFile(readinessResult, 'utf8'))
    if (readiness.ready !== true) throw new Error('Restored dashboard state did not become ready')
    writeSync(1, `Restored state ready at schema ${readiness.schemaVersion}; decrypted ${readiness.encryptedSettings} settings row(s)\n`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  writeSync(1, `Restore drill passed for ${directory}\n`)
}

async function pruneBackups(currentDirectory) {
  if (!Number.isInteger(retentionCount) || retentionCount < 1 || retentionCount > 10_000) {
    throw new Error('VERTEXADE_BACKUP_RETENTION_COUNT must be an integer from 1 to 10000')
  }
  const entries = await readdir(backupRoot, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory() && backupName.test(entry.name))
    .map((entry) => join(backupRoot, entry.name))
    .sort()
    .reverse()
  const expired = directories.filter((directory) => directory !== currentDirectory).slice(Math.max(retentionCount - 1, 0))
  for (const directory of expired) {
    await stat(join(directory, 'manifest.json'))
    await rm(directory, { recursive: true })
    writeSync(1, `Pruned expired backup ${directory}\n`)
  }
}

async function createBackup() {
  await stat(databasePath)
  await stat(settingsKeyPath)
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const directory = join(backupRoot, stamp)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const backupDatabasePath = join(directory, 'dashboard.sqlite')
  const database = new DatabaseSync(databasePath)
  try {
    database.prepare('VACUUM INTO ?').run(backupDatabasePath)
  } finally {
    database.close()
  }
  const keyName = basename(settingsKeyPath)
  await copyFile(settingsKeyPath, join(directory, keyName))
  const deploymentSource = join(dataDirectory, 'deployment.json')
  const files = ['dashboard.sqlite', keyName]
  try {
    await copyFile(deploymentSource, join(directory, 'deployment.json'))
    files.push('deployment.json')
  } catch {}
  const manifest = {
    createdAt: new Date().toISOString(),
    source: { database: databasePath, settingsKey: settingsKeyPath },
    files: await Promise.all(files.map(async (name) => ({ name, sha256: await digest(join(directory, name)) }))),
  }
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  })
  await verify(directory)
  await restoreDrill(directory)
  await pruneBackups(directory)
}

const verifyIndex = process.argv.indexOf('--verify')
const restoreDrillIndex = process.argv.indexOf('--restore-drill')
if (restoreDrillIndex >= 0) {
  const directory = process.argv[restoreDrillIndex + 1]
  if (!directory) throw new Error('Usage: pnpm backup:restore-drill --restore-drill <backup-directory>')
  await restoreDrill(resolve(directory))
} else if (verifyIndex >= 0) {
  const directory = process.argv[verifyIndex + 1]
  if (!directory) throw new Error('Usage: pnpm backup:verify --verify <backup-directory>')
  await verify(resolve(directory))
} else {
  await createBackup()
}
