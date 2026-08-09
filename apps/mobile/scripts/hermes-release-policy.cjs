const HERMES_BYTECODE_MAGIC = Buffer.from('c61fbc03c103191f', 'hex')

const ELF_MACHINE_ARCHITECTURES = new Map([
  [62, 'x64'],
  [183, 'arm64'],
])

function parseElfArchitecture(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return null
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return null

  const byteOrder = buffer[5]
  if (byteOrder !== 1 && byteOrder !== 2) return null
  const machine = byteOrder === 1 ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
  return ELF_MACHINE_ARCHITECTURES.get(machine) || `elf-machine-${machine}`
}

function isHermesBytecode(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, HERMES_BYTECODE_MAGIC.length).equals(HERMES_BYTECODE_MAGIC)
}

function isPlainJavaScript(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || isHermesBytecode(buffer)) return false
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return source.trim().length > 0 && !source.includes('\0')
  } catch {
    return false
  }
}

function percentile(sortedSamples, ratio) {
  if (sortedSamples.length === 0) return null
  const index = Math.ceil(sortedSamples.length * ratio) - 1
  return sortedSamples[Math.max(0, Math.min(index, sortedSamples.length - 1))]
}

function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error('Startup samples must be a non-empty array of non-negative numbers')
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return {
    count: sorted.length,
    medianMs: median,
    p90Ms: percentile(sorted, 0.9),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    spreadMs: sorted.at(-1) - sorted[0],
  }
}

function parseAndroidStartup(output) {
  if (typeof output !== 'string' || /(?:Error:|Exception|Activity not started)/i.test(output)) {
    throw new Error(`Android launch failed: ${String(output).trim() || 'empty activity-manager response'}`)
  }
  const match = output.match(/TotalTime:\s*(\d+)/)
  if (!match) throw new Error('Android launch did not report TotalTime')
  return Number(match[1])
}

function findCrashLines(output) {
  if (typeof output !== 'string') return []
  const crashPattern = /FATAL EXCEPTION|Fatal signal|ReactNativeJS.*(?:Error|Exception)|Terminating app due to uncaught exception|EXC_(?:BAD_ACCESS|CRASH)|SIGABRT/i
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && crashPattern.test(line))
}

async function runCli(main) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

module.exports = {
  HERMES_BYTECODE_MAGIC,
  findCrashLines,
  isHermesBytecode,
  isPlainJavaScript,
  parseAndroidStartup,
  parseElfArchitecture,
  runCli,
  summarizeSamples,
}
