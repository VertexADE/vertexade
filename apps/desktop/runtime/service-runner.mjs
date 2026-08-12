import { pathToFileURL } from 'node:url'

const entry = process.argv[2]
const parentPid = Number(process.env.VERTEXADE_DESKTOP_PARENT_PID)

if (!entry) throw new Error('Bundled service entry is required')
if (!Number.isInteger(parentPid) || parentPid <= 1) throw new Error('Bundled service parent PID is invalid')

const watchdog = setInterval(() => {
  if (process.ppid !== parentPid) process.exit(0)
}, 1_000)
watchdog.unref()

await import(pathToFileURL(entry).href)
