import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    exclude: ['**/.vertex-ade/**', '**/node_modules/**', '**/dist/**', '**/.output/**'],
  },
  check: {
    fmt: true,
  },
  fmt: {
    ignorePatterns: [
      '**/.output/**',
      '**/.output-next/**',
      '**/.output-previous/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
      'apps/mobile/**',
      'data/**',
    ],
    printWidth: 140,
    singleQuote: true,
    semi: false,
  },
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react'],
    categories: {
      correctness: 'off',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    env: {
      builtin: true,
    },
    ignorePatterns: [
      '**/.output/**',
      '**/.output-next/**',
      '**/.output-previous/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
      'apps/mobile/**',
      'data/**',
    ],
    overrides: [
      {
        files: ['**/*.{js,mjs,cjs}'],
        rules: {
          'for-direction': 'error',
          'getter-return': 'error',
          'no-async-promise-executor': 'error',
          'no-constant-condition': [
            'error',
            {
              checkLoops: false,
            },
          ],
          'no-debugger': 'error',
          'no-dupe-else-if': 'error',
          'no-dupe-keys': 'error',
          'no-duplicate-case': 'error',
          'no-fallthrough': 'error',
          'no-import-assign': 'error',
          'no-promise-executor-return': 'error',
          'no-self-assign': 'error',
          'no-unreachable': 'error',
          'no-unsafe-finally': 'error',
          'no-unsafe-negation': 'error',
          'use-isnan': 'error',
          'valid-typeof': 'error',
        },
      },
      {
        files: ['**/*.{ts,tsx}'],
        rules: {
          'for-direction': 'error',
          'getter-return': 'error',
          'no-async-promise-executor': 'error',
          'no-constant-condition': [
            'error',
            {
              checkLoops: false,
            },
          ],
          'no-debugger': 'error',
          'no-dupe-else-if': 'error',
          'no-dupe-keys': 'error',
          'no-duplicate-case': 'error',
          'no-fallthrough': 'error',
          'no-import-assign': 'error',
          'no-promise-executor-return': 'error',
          'no-self-assign': 'error',
          'no-unreachable': 'error',
          'no-unsafe-finally': 'error',
          'no-unsafe-negation': 'error',
          'use-isnan': 'error',
          'valid-typeof': 'error',
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'off',
          'typescript/await-thenable': 'error',
          'typescript/no-floating-promises': 'error',
          'typescript/no-misused-promises': [
            'error',
            {
              checksVoidReturn: false,
            },
          ],
          'typescript/only-throw-error': 'error',
          'typescript/prefer-promise-reject-errors': 'error',
          'typescript/require-array-sort-compare': 'error',
          'typescript/switch-exhaustiveness-check': 'error',
        },
      },
      {
        files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}', 'packages/extensions/*/src/web/**/*.{ts,tsx}'],
        rules: {
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'off',
        },
      },
    ],
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
  },
  staged: {
    '*.{css,html,js,json,jsonc,jsx,md,mdx,scss,ts,tsx,yaml,yml}': 'vp fmt --write',
  },
  run: {
    tasks: {
      'verify:check': {
        command: 'pnpm check',
      },
      'verify:test': {
        command: 'pnpm test:verified',
        untrackedEnv: ['TMPDIR'],
      },
      'stage:web': {
        command: 'pnpm build:staged',
        env: ['VERTEXADE_API_URL', 'VERTEXADE_API_URLS'],
        input: [{ auto: true }, '!apps/web/.output-next/**'],
        output: ['apps/web/.output-next/**'],
      },
    },
  },
})
