import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/api/src/server/database/schema/tables.ts',
  out: './apps/api/drizzle',
  dbCredentials: {
    url: process.env.VERTEXADE_DB_FILE || './data/dashboard.sqlite',
  },
  strict: true,
  verbose: true,
})
