export const automationAgentResourcesMigration = {
  version: 47,
  name: 'automation-agent-resources',
  migrate(database: { exec(sql: string): void }) {
    database.exec('ALTER TABLE automation_recipes ADD COLUMN allow_subagents INTEGER NOT NULL DEFAULT 0')
    database.exec('ALTER TABLE automation_recipes ADD COLUMN resource_selection TEXT')
  },
}
