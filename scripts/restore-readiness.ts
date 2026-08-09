#!/usr/bin/env node
// fallow-ignore-file unused-file -- spawned by backup-verified.mjs in an isolated recovery process
import process from 'node:process'
import { writeFile } from 'node:fs/promises'
import { verifyRestoredDashboardState } from '../apps/api/src/server/restore-readiness.ts'

const [databasePath, keyPath, resultPath] = process.argv.slice(2)
if (!databasePath || !keyPath) throw new Error('Usage: restore-readiness <database-path> <settings-key-path>')

const result = await verifyRestoredDashboardState(databasePath, keyPath)
if (resultPath) await writeFile(resultPath, `${JSON.stringify(result)}\n`, { mode: 0o600 })
else process.stdout.write(`${JSON.stringify(result)}\n`)
