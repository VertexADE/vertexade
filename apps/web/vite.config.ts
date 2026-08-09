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
      external: ['env', 'tslib', 'wasi_snapshot_preview1'],
    },
  },
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
