#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const minimumNode = [22, 13, 0]
const color = stdout.isTTY && !process.env.NO_COLOR
const paint = (code, value) => (color ? `\u001b[${code}m${value}\u001b[0m` : value)
const symbols = { pass: paint('32', '✓'), warn: paint('33', '!'), fail: paint('31', '×') }

export function parseVersion(value) {
  const match = String(value || '').match(/v?(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

export function versionAtLeast(version, minimum = minimumNode) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true
    if (version[index] < minimum[index]) return false
  }
  return true
}

function command(commandName, args, runner = spawnSync) {
  const result = runner(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const output = String(result.stdout || result.stderr || '').trim()
  return {
    available: !result.error && result.status === 0,
    output: output.split(/\r?\n/)[0] || '',
    status: result.status,
    error: result.error?.message || '',
  }
}

export function collectChecks(runner = spawnSync) {
  const nodeVersion = parseVersion(process.version)
  const tools = {
    mise: command('mise', ['--version'], runner),
    pnpm: command('pnpm', ['--version'], runner),
    git: command('git', ['--version'], runner),
    githubCli: command('gh', ['--version'], runner),
    githubAuth: command('gh', ['auth', 'status', '--active'], runner),
    codex: command('codex', ['--version'], runner),
    opencode: command('opencode', ['--version'], runner),
    claude: command('claude', ['--version'], runner),
    pm2: command('pm2', ['--version'], runner),
  }
  const checks = [
    {
      id: 'mise',
      label: 'mise tool manager (recommended)',
      state: tools.mise.available ? 'pass' : 'warn',
      required: false,
      detail: tools.mise.output || 'Recommended for installing the pinned Node.js and pnpm versions',
    },
    {
      id: 'node',
      label: 'Node.js 22.13 or newer',
      state: nodeVersion && versionAtLeast(nodeVersion) ? 'pass' : 'fail',
      required: true,
      detail: process.version,
    },
    {
      id: 'pnpm',
      label: 'pnpm',
      state: tools.pnpm.available ? 'pass' : 'fail',
      required: true,
      detail: tools.pnpm.output || tools.pnpm.error,
    },
    {
      id: 'git',
      label: 'Git',
      state: tools.git.available ? 'pass' : 'fail',
      required: true,
      detail: tools.git.output || tools.git.error,
    },
    {
      id: 'github-cli',
      label: 'GitHub CLI',
      state: tools.githubCli.available ? 'pass' : 'warn',
      required: false,
      detail: tools.githubCli.output || 'Install from https://cli.github.com',
    },
    {
      id: 'github-auth',
      label: 'GitHub authentication',
      state: tools.githubAuth.available ? 'pass' : 'warn',
      required: false,
      detail: tools.githubAuth.available ? 'Authenticated' : 'Run gh auth login',
    },
    {
      id: 'agent',
      label: 'At least one execution agent',
      state: tools.codex.available || tools.opencode.available || tools.claude.available ? 'pass' : 'warn',
      required: false,
      detail:
        [tools.codex.available && 'Codex', tools.opencode.available && 'OpenCode', tools.claude.available && 'Claude Code']
          .filter(Boolean)
          .join(', ') || 'Install Codex, OpenCode, or Claude Code',
    },
    {
      id: 'pm2',
      label: 'PM2 production runner',
      state: tools.pm2.available ? 'pass' : 'warn',
      required: false,
      detail: tools.pm2.output || 'Optional; pnpm start works without PM2',
    },
  ]
  return { checks, tools }
}

export function summarizeChecks(checks) {
  return {
    blockers: checks.filter((check) => check.required && check.state === 'fail'),
    advisories: checks.filter((check) => !check.required && check.state !== 'pass'),
    ready: checks.every((check) => !check.required || check.state === 'pass'),
  }
}

function printChecks(checks) {
  for (const check of checks) {
    const symbol = symbols[check.state]
    console.log(`  ${symbol} ${check.label}${check.detail ? paint('2', ` · ${check.detail}`) : ''}`)
  }
}

function execute(commandName, args) {
  console.log(`\n${paint('36', '→')} ${commandName} ${args.join(' ')}`)
  const result = spawnSync(commandName, args, { stdio: 'inherit' })
  if (result.error || result.status !== 0)
    throw new Error(`${commandName} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
}

async function confirm(question, defaultValue, rl) {
  const hint = defaultValue ? 'Y/n' : 'y/N'
  const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase()
  if (!answer) return defaultValue
  return answer === 'y' || answer === 'yes'
}

async function guidedInstall({ yes = false } = {}) {
  console.log(`\n${paint('1;36', 'VertexADE setup')}\n`)
  console.log('This guide takes you from a fresh clone to a verified, running workspace. Authentication remains explicit.\n')
  console.log(`${paint('1', 'Step 1 of 4 · Check the workstation')}`)
  const result = collectChecks()
  printChecks(result.checks)
  const summary = summarizeChecks(result.checks)
  if (!summary.ready) {
    console.error(`\n${paint('31', 'Required tools are missing.')}`)
    console.error(`  ${paint('1', 'Recommended:')} install mise from ${paint('4;36', 'https://mise.jdx.dev/getting-started.html')}`)
    console.error(`  Then run: ${paint('36', 'mise trust && mise install && pnpm setup')}`)
    console.error(`  Or install Node.js 22.13+, pnpm 11, and Git manually, then rerun ${paint('36', 'pnpm setup')}.`)
    process.exitCode = 1
    return
  }

  const rl = yes ? null : createInterface({ input: stdin, output: stdout })
  try {
    console.log(`\n${paint('1', 'Step 2 of 4 · Align tool versions')}`)
    if (result.tools.mise.available) {
      const align = yes || (await confirm('Use mise to install the versions pinned by this repository?', true, rl))
      if (align) execute('mise', ['install'])
    } else {
      console.log(
        `${paint('33', 'mise is not installed.')} Continuing with the current Node.js and pnpm. For reproducible versions, install mise later and run ${paint('36', 'mise trust && mise install')}.`,
      )
    }

    if (summary.advisories.some((check) => check.id === 'github-auth')) {
      console.log(
        `\n${paint('33', 'GitHub is not authenticated yet.')} Repository sync requires either \`gh auth login\` or a GitHub App configured after startup.`,
      )
      if (!yes && result.tools.githubCli.available && (await confirm('Open the GitHub CLI login now?', false, rl)))
        execute('gh', ['auth', 'login'])
    }

    console.log(`\n${paint('1', 'Step 3 of 4 · Install and verify VertexADE')}`)
    const install = yes || (await confirm('Install exact project dependencies with pnpm?', true, rl))
    if (install) execute('pnpm', ['install', '--frozen-lockfile'])

    const validate = yes || (await confirm('Run type checks, tests, and the production build?', true, rl))
    if (validate) {
      execute('pnpm', ['check'])
      execute('pnpm', ['test'])
      execute('pnpm', ['build'])
    }

    console.log(`\n${paint('1', 'Step 4 of 4 · Start and finish in the UI')}`)
    console.log(`${paint('32;1', 'Setup complete.')} Choose how to start:`)
    console.log(`  Development: ${paint('36', 'pnpm dev')}`)
    console.log(`  Production:  ${paint('36', 'pnpm start')}`)
    console.log(
      `  PM2:         ${paint('36', 'cp -n ecosystem.config.example.cjs ecosystem.config.cjs && pm2 start ecosystem.config.cjs && pm2 save')}`,
    )
    console.log(`\nThen open ${paint('4;36', 'http://localhost:4173/setup')} to finish GitHub, agent, and extension configuration.`)
  } finally {
    rl?.close()
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const result = collectChecks()
  if (args.has('--json')) {
    const summary = summarizeChecks(result.checks)
    console.log(JSON.stringify({ ...summary, checks: result.checks }, null, 2))
    if (!summary.ready) process.exitCode = 1
    return
  }
  if (args.has('--check')) {
    console.log(`\n${paint('1;36', 'VertexADE prerequisites')}\n`)
    printChecks(result.checks)
    const summary = summarizeChecks(result.checks)
    if (!summary.ready) process.exitCode = 1
    return
  }
  await guidedInstall({ yes: args.has('--yes') })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
