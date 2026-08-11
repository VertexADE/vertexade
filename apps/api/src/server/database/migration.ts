import type { DatabaseSync } from 'node:sqlite'

export type Migration = {
  version: number
  name: string
  migrate(database: DatabaseSync): void
}
