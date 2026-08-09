# VertexADE mobile

The Expo app is a native host for portable extension workspaces and settings. It never imports an Airtable, Azure, agent, or other extension UI bundle. Instead it reads the same validated manifest as web, renders host-native controls, and calls the same scoped API through `@vertexade/platform-client`.

## Run

```bash
pnpm install
EXPO_PUBLIC_VERTEXADE_URL=http://192.168.1.10:4174 pnpm --filter @vertexade/mobile start
```

Use `http://10.0.2.2:4174` for the Android emulator and `http://localhost:4174` for an iOS simulator running on the same machine. A physical device needs a LAN-reachable API address.

The extension list includes enabled workspaces, settings-only agents, and disabled extensions that remain configurable. An extension with both surfaces exposes Workspace and Settings tabs.

Portable settings support secrets, discovery actions, selects, repeatable strings, nested object lists, reordering, reset confirmations, and the shared agent environment editor. Stored secrets are never returned by the API. A newly entered secret is sent directly to the extension backend and is not persisted by the app.

The shared client supports a dynamic `getAccessToken` hook and per-request required authentication, but the current API has no mobile authentication boundary. Use this app only against a local or otherwise trusted development network until the platform adds authenticated sessions, secure device token storage, authorization enforcement, and a restrictive production network policy.

## Validate and package

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
