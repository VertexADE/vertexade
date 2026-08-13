import { DatabaseSync } from 'node:sqlite'

export function columns(database: DatabaseSync, table: string) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => String(column.name)),
  )
}

export function tableExists(database: DatabaseSync, table: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

export function addColumn(database: DatabaseSync, table: string, existing: Set<string>, name: string, definition: string) {
  if (existing.has(name)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  existing.add(name)
}
