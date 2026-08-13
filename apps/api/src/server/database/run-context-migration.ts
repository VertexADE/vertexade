export const runContextMigration = {
  version: 44,
  name: 'agent-run-context-summary',
  migrate(database: { exec(sql: string): unknown }) {
    database.exec(`
      ALTER TABLE jobs ADD COLUMN run_context TEXT;
      ALTER TABLE jobs ADD COLUMN display_prompt TEXT;
    `)
  },
}
