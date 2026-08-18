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
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'octane-runtime',
              test: (moduleId: string) => moduleId.includes('/node_modules/octane/'),
              includeDependenciesRecursively: false,
              priority: 30,
            },
            {
              name: 'tanstack-query',
              test: (moduleId: string) => moduleId.includes('/@tanstack/react-query/') || moduleId.includes('/@tanstack/query-core/'),
              priority: 20,
            },
            {
              // Keep the stable renderer runtime cacheable without forcing
              // application modules across chunk boundaries. Forced app-level
              // groups can create circular ESM chunks and capture undefined
              // component exports while the entry is still initializing.
              name: 'react-dom-runtime',
              test: (moduleId: string) => moduleId.includes('/node_modules/react-dom/') || moduleId.includes('/node_modules/scheduler/'),
              includeDependenciesRecursively: false,
              priority: 15,
            },
          ],
        },
      },
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
              headers: {
                'cache-control': 'no-cache, no-store, must-revalidate',
                'cross-origin-opener-policy': 'same-origin',
                'permissions-policy': 'camera=(), geolocation=(), microphone=()',
                'referrer-policy': 'no-referrer',
                'x-content-type-options': 'nosniff',
                'x-frame-options': 'DENY',
              },
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
