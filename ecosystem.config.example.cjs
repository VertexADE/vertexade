const shared = {
  NODE_ENV: 'production',
  APP_ROOT: __dirname,
}

module.exports = {
  apps: [
    {
      name: 'vertexade-api',
      script: 'node_modules/.bin/tsx',
      args: 'apps/api/src/server/index.ts',
      cwd: __dirname,
      interpreter: 'none',
      env: {
        ...shared,
        API_HOST: '127.0.0.1',
        API_PORT: '4174',
      },
      max_memory_restart: '2G',
      kill_timeout: 15000,
      listen_timeout: 15000,
      time: true,
    },
    {
      name: 'vertexade',
      script: 'apps/web/.output/server/index.mjs',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        ...shared,
        HOST: '0.0.0.0',
        PORT: '4173',
        VERTEXADE_API_URL: 'http://127.0.0.1:4174',
        // For a unified multi-server workspace, replace VERTEXADE_API_URL with:
        // VERTEXADE_API_URLS: JSON.stringify([
        //   { id: 'local', label: 'Local', url: 'http://127.0.0.1:4174' },
        //   { id: 'team', label: 'Team', url: 'https://vertexade-api.internal' },
        // ]),
      },
      max_memory_restart: '768M',
      time: true,
    },
  ],
}
