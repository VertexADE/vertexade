import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { nitro } from 'nitro/vite'
import { defineConfig, lazyPlugins } from 'vite-plus'

const outputDirectory = process.env.VERTEXADE_WEB_OUTPUT_DIR

export default defineConfig({
  build: {
    rolldownOptions: {
      // `tslib` is used by browser dependencies such as Radix and RxJS. It must
      // stay inside the client bundle: a bare `from "tslib"` import cannot be
      // resolved by a browser and prevents the application from hydrating.
      external: ['env', 'wasi_snapshot_preview1'],
    },
  },
  // The Node build resolves tslib from the packaged server dependencies. Keeping
  // it external here also preserves its CommonJS default-export interoperability.
  ssr: { external: ['tslib'] },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
  },
  plugins: process.env.VITEST
    ? []
    : lazyPlugins(() => [
        nitro({
          ...(outputDirectory ? { output: { dir: outputDirectory } } : {}),
          routeRules: {
            '/**': {
              headers: { 'cache-control': 'no-cache, no-store, must-revalidate' },
            },
          },
        }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        babel({
          presets: [
            reactCompilerPreset({
              target: '19',
              panicThreshold: 'critical_errors',
            }),
          ],
        }),
      ]),
})
