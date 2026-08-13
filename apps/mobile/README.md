# VertexADE mobile

The Expo app is the native counterpart of the responsive web workspace for Focus, pull requests, Work items, and agent threads, plus a host for portable extension workspaces and settings. It never imports an Airtable, Azure, agent, or other extension UI bundle. Each VertexADE web service on port 4173 is paired and stored independently, and scoped API calls are routed through that direct connection with `@vertexade/platform-client`.

## Run

```bash
pnpm install
EXPO_PUBLIC_VERTEXADE_URL=http://192.168.1.10:4173 pnpm --filter @vertexade/mobile start
```

Use `http://10.0.2.2:4173` for the Android emulator and `http://localhost:4173` for an iOS simulator running on the same machine. A physical device needs a LAN-reachable service address. Server connections are deliberately flat and non-transitive: pairing server A never imports servers linked by A. Pair server B separately with its own one-time link and session token. The app loads every directly paired primary backend in parallel and merges the results into one workspace; each item retains its source URL so mutations use only that server's token and backend.

The app opens on Focus and follows the web-mobile information hierarchy with persistent bottom navigation for Focus, Work, Threads, PRs, and More. Connection health, adding another direct server, and portable extensions live under More; normal work never requires switching an active server. Creating a draft PR follows the platform lifecycle: mobile creates Work, starts its agent thread, and enables draft-PR delivery. It does not bypass the agent by inventing a separate manual source-control contract.

Each primary card opens a native full-detail sheet. PR details include the overview, description, review conversation, checks, commits, changed files, and diff preview, with an action to link the PR into Work. Work details include the complete outcome, lifecycle controls, agent threads, event timeline, resources, relations, and context transfers. Thread details include activity, queued messages, agent output, changed files and diff, run metadata, structured input, follow-up/queue/steer controls, interrupt, and retry where the server reports those actions as available.

The extension list includes enabled workspaces, settings-only agents, and disabled extensions that remain configurable. An extension with both surfaces exposes Workspace and Settings tabs.

Portable settings support secrets, discovery actions, selects, repeatable strings, nested object lists, reordering, reset confirmations, and the shared agent environment editor. Stored secrets are never returned by the API. A newly entered secret is sent directly to the extension backend and is not persisted by the app.

Every paired service has its own session token in device-only secure storage. The client resolves authentication by normalized service URL, so tokens cannot be reused across independently paired servers.

## Validate and package

The native iOS app embeds FluidAudio's Parakeet ASR model so voice input never downloads model data on the user's device. Xcode runs `scripts/download-bundled-voice-model.sh` before copying resources. The idempotent script stores the generated 462 MB model directory under the ignored `ios/VertexADE/FluidAudioModels` path, so CI and new checkouts need network access once while preparing a native build; installed apps then work offline.

```bash
pnpm --filter @vertexade/mobile check
pnpm --filter @vertexade/mobile test:ci
pnpm --filter @vertexade/mobile export
pnpm --filter @vertexade/mobile export:compare
```

`export` is the releasable path and emits Hermes bytecode for Android and iOS.
Expo's packaged Linux compiler is x64; on ARM64 Linux the release wrapper uses
`qemu-x86_64` after probing the compiler. It fails closed with an actionable
message when emulation is unavailable. Native x64 and macOS hosts stay on
Expo's direct compiler path.

The `Build unsigned iOS app` GitHub Actions workflow generates the native Expo
project on a macOS runner and uploads `VertexADE-ios-simulator.zip`. This is an
unsigned simulator `.app` for development and testing; it is not an App Store
archive and cannot be installed on a physical iPhone.

For source inspection only, `pnpm --filter @vertexade/mobile export:analysis`
emits plain JavaScript plus source maps. That output is not a
release artifact. `export:compare` cold-exports both forms, validates their
formats and both platforms, and writes
`artifacts/mobile-performance/bundle-comparison.json`.

Run the deterministic fixture with `pnpm --filter @vertexade/mobile fixture:device`,
then execute `.maestro/mobile-smoke.yaml` against an
installable app. `.eas/workflows/mobile-e2e.yml` defines the same manual journey
for Android and iOS. Configure an Expo project and production API/auth settings
before running EAS Build. Device screenshots, recordings, fixture requests,
startup samples, and crash evidence belong under `artifacts/mobile-device/` and
must not be committed.

The EAS journey runs ten measured cold launches after one warm-up and captures
raw platform logs before and after Maestro. To run the same probe locally after
installing the app, use `node apps/mobile/scripts/device-runtime-probe.mjs
android` or replace `android` with `ios`; ADB or a booted iOS simulator is
required. A missing sample, failed launch, or fatal log marker fails the probe.
