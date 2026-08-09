const {
  HERMES_BYTECODE_MAGIC,
  findCrashLines,
  isHermesBytecode,
  isPlainJavaScript,
  parseAndroidStartup,
  parseElfArchitecture,
  runCli,
  summarizeSamples,
} = require('../../scripts/hermes-release-policy.cjs') as {
  HERMES_BYTECODE_MAGIC: Buffer
  findCrashLines: (output: string) => string[]
  isHermesBytecode: (buffer: Buffer) => boolean
  isPlainJavaScript: (buffer: Buffer) => boolean
  parseAndroidStartup: (output: string) => number
  parseElfArchitecture: (buffer: Buffer) => string | null
  runCli: (main: () => Promise<void>) => Promise<void>
  summarizeSamples: (samples: number[]) => {
    count: number
    medianMs: number
    p90Ms: number
    minMs: number
    maxMs: number
    spreadMs: number
  }
}

function elf(machine: number, byteOrder = 1) {
  const buffer = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(buffer)
  buffer[4] = 2
  buffer[5] = byteOrder
  if (byteOrder === 1) buffer.writeUInt16LE(machine, 18)
  else buffer.writeUInt16BE(machine, 18)
  return buffer
}

describe('mobile release policy', () => {
  test('detects x64 and ARM64 ELF compilers without executing them', () => {
    expect(parseElfArchitecture(elf(62))).toBe('x64')
    expect(parseElfArchitecture(elf(183))).toBe('arm64')
    expect(parseElfArchitecture(elf(62, 2))).toBe('x64')
    expect(parseElfArchitecture(Buffer.from('not an ELF'))).toBeNull()
  })

  test('distinguishes Hermes bytecode from analysis JavaScript', () => {
    const bytecode = Buffer.concat([HERMES_BYTECODE_MAGIC, Buffer.alloc(24)])
    const source = Buffer.from('globalThis.__vertexade = true;\n')
    expect(isHermesBytecode(bytecode)).toBe(true)
    expect(isPlainJavaScript(bytecode)).toBe(false)
    expect(isHermesBytecode(source)).toBe(false)
    expect(isPlainJavaScript(source)).toBe(true)
    expect(isPlainJavaScript(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false)
  })

  test('keeps source maps outside the bundle comparison contract', async () => {
    const comparisonSource = await require('node:fs/promises').readFile(
      require('node:path').resolve(__dirname, '../../scripts/compare-exports.mjs'),
      'utf8',
    )
    expect(comparisonSource).toContain("plainJavaScript: !sourceMap")
    expect(comparisonSource).toContain("file.path.endsWith('.map')")
  })

  test('summarizes startup samples without hiding invalid input', () => {
    expect(summarizeSamples([100, 90, 140, 110, 120])).toEqual({
      count: 5,
      medianMs: 110,
      p90Ms: 140,
      minMs: 90,
      maxMs: 140,
      spreadMs: 50,
    })
    expect(() => summarizeSamples([])).toThrow('non-empty')
    expect(() => summarizeSamples([100, Number.NaN])).toThrow('non-negative')
  })

  test('parses Android timing and retains fatal runtime evidence', () => {
    expect(parseAndroidStartup('Status: ok\nTotalTime: 341\nWaitTime: 350')).toBe(341)
    expect(() => parseAndroidStartup('Error: Activity class does not exist')).toThrow('launch failed')
    expect(findCrashLines('routine\nFATAL EXCEPTION: main\nroutine\nEXC_CRASH (SIGABRT)')).toEqual([
      'FATAL EXCEPTION: main',
      'EXC_CRASH (SIGABRT)',
    ])
  })

  test('turns a rejected release command into a visible failing exit', async () => {
    const previousExitCode = process.exitCode
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runCli(async () => {
        throw new Error('release failed')
      })
      expect(error).toHaveBeenCalledWith('release failed')
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode
      error.mockRestore()
    }
  })
})
