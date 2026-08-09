# VertexADE

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/vertexade-logo-dark.svg">
  <img src="apps/web/public/vertexade-logo.svg" alt="VertexADE" width="500">
</picture>

VertexADE is a local-first control plane for software work performed by people and coding agents. It brings repositories, pull requests, durable work items, worktrees, agent threads, reviews, automations, integrations, and deployments into one UI. Work can begin in VertexADE or in an external agent thread and remain visible and manageable from the same workspace.

This repository is the `0.0.1` pnpm monorepo for the web application, API, Expo client, Electron desktop application, installable server-and-UI bundle, shared platform packages, and built-in extensions.

## What VertexADE does

- Treats **Work** as the durable coordination object above individual agent sessions.
- Starts, resumes, forks, interrupts, and reviews supported agent threads from the UI.
- Associates one Work item with multiple repositories, worktrees, branches, pull requests, checks, deployments, schedules, external records, and findings.
- Connects multiple VertexADE servers through **Settings → Servers**, without requiring browser server-origin environment configuration.
- Routes reads and mutations to the server that owns each item while preserving a unified frontend.
- Discovers execution agents, models, skills, MCP resources, references, and plugin actions from the selected server.
- Stores operational state in SQLite and projects dashboard data into a browser-local RxDB cache for responsive reads.
- Provides a portable extension model shared by the web and Expo hosts.
- Ships as source, an npm-installed server with bundled UI, an npm-installed desktop launcher, and native Electron installers.

## Choose how to run it

### From source

Requirements:

- Node.js 22.13 or newer
- pnpm 11
- Git
- GitHub CLI when using GitHub features
- At least one supported agent CLI for agent execution

```bash
git clone git@github.com:VertexADE/vertexade.git
cd vertexade
pnpm install
pnpm setup
pnpm dev
```

The development command starts the API and web application. Open <http://localhost:4173>. The API listens on port `4174`; browser API requests stay same-origin through the web server.

Useful setup modes:

```bash
pnpm setup:check             # read-only prerequisite report
pnpm --silent setup --json   # machine-readable report
pnpm setup --yes             # guided non-interactive setup and checks
```

### Installable server and UI

The `vertexade` npm package contains the production API, web UI, built-in extension runtime, and CLI entrypoint:

```bash
pnpm add --global vertexade
vertexade
```

The bundle chooses and serves its own local API/UI relationship. A frontend server-origin variable is not required. Add other installations later from **Settings → Servers**.

### Desktop application

Install the desktop launcher from npm:

```bash
pnpm add --global @vertexade/desktop
vertexade-desktop
```

Or download a platform installer from GitHub Releases. The Electron application bundles the API, production web UI, built-in extensions, and required runtime assets. Its services bind to randomized loopback ports and stop with the application.

To run or package Electron from source:

```bash
pnpm dev:desktop
pnpm build:desktop
```

### Expo mobile application

```bash
EXPO_PUBLIC_VERTEXADE_URL=http://192.168.1.10:4174 pnpm dev:mobile
pnpm build:mobile
```

Use a simulator- or device-reachable URL. The mobile host is intended for local or trusted development networks until authenticated mobile sessions are available. See [apps/mobile/README.md](apps/mobile/README.md) for platform setup and EAS guidance.

## Data and managed worktrees

Packaged installations keep VertexADE-owned state below:

1. `$XDG_DATA_HOME/vertex-ade` when `XDG_DATA_HOME` is set.
2. `~/.vertex-ade` otherwise.

This location holds application data and can also hold managed repositories and worktrees. The desktop settings UI exposes workspace and worktree placement so desktop users can keep those resources inside the VertexADE data directory. `VERTEXADE_WORKTREE_ROOT` remains available as an explicit host-level override.

Back up the data directory before upgrades or migrations. Source deployments can use the verified helpers:

```bash
pnpm backup
pnpm backup:verify
pnpm backup:restore-drill
```

See [docs/installation.md](docs/installation.md) for production operation, backup details, and troubleshooting.

## Multiple servers

Server federation is configured in the application, not baked into a frontend build:

1. Open **Settings → Servers**.
2. Add the public URL of another VertexADE backend.
3. Let the current backend verify the remote identity and network destination.
4. Select that server when creating Work or browsing server-owned resources.

The UI shows ownership badges and sends later operations back to the correct backend. A remote Work item can use that server's repositories, agents, models, skills, MCP resources, references, threads, and extension actions. Server validation rejects unsafe private-network destinations when adding public remotes.

## Work and agent threads

A Work item is independent of the process that created it. It may start from the VertexADE UI, an imported pull request or external record, an automation, or a supported external work thread. From the UI you can continue execution, inspect its event timeline, provide requested input, interrupt or fork it, review diffs, connect resources, and follow delivery state.

Agent launches default to a combined Work directory. Repository worktrees are isolated children, while sessions can start from their shared parent when cross-repository context is required. Repository-folder mode remains available for compatibility. Shared Markdown memory follows the Work item across agent providers and worktrees.

Supported built-in execution extensions include ACP, Claude Code, Codex, and OpenCode. Each extension owns launch and continuation behavior, event normalization, permissions, settings, and portable UI declarations.

### Tool executable overrides

VertexADE normally discovers command-line tools through the server process `PATH`. To use tools installed elsewhere, open **Settings → Agent execution → Tool executable paths** and enter an executable name or path for Git, GitHub CLI, Codex, Claude Code, OpenCode, pnpm, PM2, Docker, or Fallow. Empty fields continue to use `PATH`.

Overrides are stored in the backend configuration and apply immediately to setup checks, repository and GitHub operations, preview infrastructure, and agent launches. They also propagate into nested agent bridges, so desktop and npm installations can select host-installed tools without environment-based server-origin configuration.

## Extensions and plugins

Extensions are workspace packages under `packages/extensions/<id>`. They can contribute execution agents, source-control providers, work management, records, findings, deployments, settings, portable UI surfaces, automation primitives, actions, triggers, gates, and evidence collectors.

The platform is designed for context-aware plugins rather than isolated buttons. An extension receives scoped host services and typed context for the active server, Work item, repository, thread, and provider. It can declare capabilities and dependencies, expose schema-validated actions, participate in durable recipes, and render the same JSON-safe surfaces in web and native hosts. Credentials are encrypted, permissions are deny-by-default, and extension failures are isolated from the host.

Create an extension scaffold with:

```bash
pnpm create:extension example "Example integration"
```

Important references:

- [Module platform](docs/module-platform.md)
- [Work platform](docs/work-platform.md)
- [Portable extension authoring](docs/portable-extension-authoring.md)
- [Platform client SDK](docs/platform-client-sdk.md)
- [Extension portability migration](docs/extension-portability-migration-plan.md)
- [Repository architecture and extension guide](docs/repository-architecture-and-extension-guide.md)

## Monorepo map

```text
apps/
  api/       API, SQLite authority, orchestration, federation, and extension host
  web/       TanStack Start frontend
  mobile/    Expo host for portable extension surfaces
  desktop/   Electron host and npm desktop launcher
  server/    npm-distributed API + production UI bundle
packages/
  platform-client/         shared transport and host client
  platform-contracts/      framework-neutral contracts
  platform-extension-sdk/  extension authoring SDK
  platform-server/         server-side extension utilities
  ui/                      shared product UI and portable web renderers
  extensions/              built-in agents and integrations
```

pnpm owns dependency installation, workspace execution, lockfile state, development, builds, tests, and publishing preparation. Do not generate npm or Yarn lockfiles.

## Development commands

```bash
pnpm dev                 # API + web development servers
pnpm check               # formatting, lint, and type checks
pnpm lint                # repository lint
pnpm test                # workspace test suite
pnpm test:verified       # uncached, serialized verification suite
pnpm build               # production web build and bundle checks
pnpm build:mobile        # Expo export
pnpm build:desktop       # Electron installers
pnpm format              # apply repository formatting
pnpm format:check        # verify formatting only
```

Database development commands:

```bash
pnpm db:generate
pnpm db:pull
pnpm db:studio
```

## Releases

All workspace packages begin at version `0.0.1`. The GitHub Actions release workflow:

- validates and packages Electron on Linux, macOS, and Windows;
- uploads platform artifacts;
- publishes `vertexade` and `@vertexade/desktop` to npm with provenance; and
- attaches desktop installers to the corresponding GitHub release.

Publishing requires the repository's npm trusted-publishing or token configuration. Release jobs run from pnpm's frozen lockfile to keep source, CI, and published bundles reproducible.

## Security model

- Credentials are configured through host or extension settings and stored encrypted where supported.
- Extension services are permission-scoped and routes are namespaced.
- Added servers are identity-checked and subject to outbound-network policy.
- Desktop services bind only to loopback interfaces.
- Generated worktrees remain separated while sharing the source repository's Git object database.
- Secret values should never be committed; use the UI, credential stores, or CI secret configuration.

For responsible disclosure, open a private GitHub security advisory rather than a public issue.

## Documentation

The `docs/` directory contains focused references for installation, architecture, design, data caching, Work semantics, integrations, and extension contracts. `TOFIX.md` tracks unfinished or intentionally deferred work; it is not a substitute for release validation.

## License

VertexADE is licensed under the [MIT License](LICENSE).
