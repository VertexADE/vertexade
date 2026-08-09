import { randomUUID } from 'node:crypto'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { extensionStates } from '../database/schema/tables.ts'
import type { ExtensionCacheStore } from './cache.ts'
import type { ExtensionRegistry } from './registry.ts'
import type { SettingsStore } from '../settings/settings-store.ts'
import { and, asc, eq, ne, sql } from 'drizzle-orm'

type ExtensionStatePhase = 'stable' | 'applying' | 'repair_required'

export type ExtensionState = {
  id: string
  desiredEnabled: boolean
  appliedEnabled: boolean
  phase: ExtensionStatePhase
  pending: boolean
  error: string | null
}

type ExtensionTransitionResult = ExtensionState & {
  ok: boolean
  warning?: string
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class ExtensionStateStore {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  seedLegacy(states: Record<string, boolean>) {
    this.database.transaction((transaction) => {
      for (const [moduleId, enabled] of Object.entries(states))
        transaction
          .insert(extensionStates)
          .values({ moduleId, desiredEnabled: enabled, appliedEnabled: enabled })
          .onConflictDoNothing({ target: extensionStates.moduleId })
          .run()
    })
  }

  // fallow-ignore-next-line unused-class-member -- used through dashboard runtime injection
  desired(moduleId: string, fallback = true) {
    return this.read(moduleId)?.desiredEnabled ?? fallback
  }

  register(moduleId: string, appliedEnabled: boolean, failed = false) {
    const current = this.read(moduleId)
    if (!current) {
      this.database
        .insert(extensionStates)
        .values({ moduleId, desiredEnabled: appliedEnabled, appliedEnabled, phase: failed ? 'repair_required' : 'stable' })
        .run()
      return this.read(moduleId)!
    }
    const stable = current.desiredEnabled === appliedEnabled && !failed
    this.database
      .update(extensionStates)
      .set({
        appliedEnabled,
        phase: stable ? 'stable' : 'repair_required',
        lastError: failed ? current.error || 'Extension lifecycle initialization failed' : stable ? null : current.error,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(extensionStates.moduleId, moduleId))
      .run()
    return this.read(moduleId)!
  }

  begin(moduleId: string, desiredEnabled: boolean) {
    const operationId = randomUUID()
    this.database
      .update(extensionStates)
      .set({
        desiredEnabled,
        phase: 'applying',
        operationId,
        attempts: sql`${extensionStates.attempts} + 1`,
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(extensionStates.moduleId, moduleId))
      .run()
    return operationId
  }

  stable(moduleId: string, operationId: string, appliedEnabled: boolean) {
    this.database
      .update(extensionStates)
      .set({
        appliedEnabled,
        phase: 'stable',
        operationId: null,
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(extensionStates.moduleId, moduleId), eq(extensionStates.operationId, operationId)))
      .run()
    return this.read(moduleId)!
  }

  repair(moduleId: string, operationId: string, appliedEnabled: boolean, error: unknown) {
    this.database
      .update(extensionStates)
      .set({
        appliedEnabled,
        phase: 'repair_required',
        operationId,
        lastError: message(error).slice(0, 2000),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(extensionStates.moduleId, moduleId), eq(extensionStates.operationId, operationId)))
      .run()
    return this.read(moduleId)!
  }

  read(moduleId: string): ExtensionState | null {
    const row = this.database.select().from(extensionStates).where(eq(extensionStates.moduleId, moduleId)).get()
    return row
      ? {
          id: row.moduleId,
          desiredEnabled: row.desiredEnabled,
          appliedEnabled: row.appliedEnabled,
          phase: row.phase as ExtensionStatePhase,
          pending: row.phase !== 'stable',
          error: row.lastError,
        }
      : null
  }

  all() {
    return this.database
      .select()
      .from(extensionStates)
      .orderBy(asc(extensionStates.moduleId))
      .all()
      .map((row) => this.read(row.moduleId)!)
  }

  appliedStates() {
    return Object.fromEntries(this.all().map((state) => [state.id, state.appliedEnabled]))
  }

  pending() {
    return this.database
      .select({ moduleId: extensionStates.moduleId })
      .from(extensionStates)
      .where(ne(extensionStates.phase, 'stable'))
      .all()
      .map((row) => row.moduleId)
  }
}

export function initializeExtensionStateStore(database: DrizzleDashboardDatabase, settings: SettingsStore) {
  const store = new ExtensionStateStore(database)
  store.seedLegacy(settings.read<Record<string, boolean>>('extensions', {}))
  if (settings.has('extensions')) settings.delete('extensions')
  return store
}

type CoordinatorDependencies = {
  store: ExtensionStateStore
  extensions: ExtensionRegistry
  syncTriggers(): Promise<void>
  cache?: Pick<ExtensionCacheStore, 'invalidateNamespace'>
  notify(reason: string): void
}

export class ExtensionStateCoordinator {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  registerInstalled() {
    for (const installed of this.dependencies.extensions.installed())
      this.dependencies.store.register(installed.extension.manifest.id, installed.enabled, Boolean(installed.failure))
  }

  state(id: string) {
    const installed = this.dependencies.extensions.installed(id)
    if (!installed) return null
    return this.dependencies.store.read(id) || this.dependencies.store.register(id, installed.enabled, Boolean(installed.failure))
  }

  // fallow-ignore-next-line unused-class-member -- used through dashboard runtime injection
  states() {
    return this.dependencies.store.appliedStates()
  }

  // fallow-ignore-next-line unused-class-member -- used through dashboard runtime injection
  enabled(id: string) {
    return Boolean(this.dependencies.extensions.installed(id)?.enabled)
  }

  // fallow-ignore-next-line unused-class-member -- used through dashboard runtime injection
  decorate<T extends { id: string; enabled: boolean }>(module: T) {
    const state = this.state(module.id)
    return state
      ? {
          ...module,
          enabled: state.appliedEnabled,
          desiredEnabled: state.desiredEnabled,
          pending: state.pending,
          ...(state.error ? { stateError: state.error } : {}),
        }
      : module
  }

  toggle(id: string, desiredEnabled: boolean) {
    return this.serial(id, () => this.transition(id, desiredEnabled))
  }

  async reconcile() {
    for (const id of this.dependencies.store.pending()) {
      const state = this.state(id)
      if (!state) continue
      await this.toggle(id, state.desiredEnabled)
    }
  }

  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.locks.set(id, current)
    return current.finally(() => {
      if (this.locks.get(id) === current) this.locks.delete(id)
    })
  }

  private notifyStable(state: ExtensionState): ExtensionTransitionResult {
    try {
      this.dependencies.notify('extensions_updated')
      return { ...state, ok: true }
    } catch (error) {
      return { ...state, ok: true, warning: `State changed, but notification failed: ${message(error)}` }
    }
  }

  private async apply(id: string, desiredEnabled: boolean, operationId: string) {
    await this.dependencies.extensions.setEnabled(id, desiredEnabled)
    await this.dependencies.syncTriggers()
    if (!desiredEnabled) this.dependencies.cache?.invalidateNamespace(id)
    const appliedEnabled = Boolean(this.dependencies.extensions.installed(id)?.enabled)
    return this.notifyStable(this.dependencies.store.stable(id, operationId, appliedEnabled))
  }

  private async rollback(id: string, previousApplied: boolean) {
    const installed = this.dependencies.extensions.installed(id)
    if (installed?.enabled !== previousApplied) await this.dependencies.extensions.setEnabled(id, previousApplied)
    await this.dependencies.syncTriggers()
  }

  private persistRepair(id: string, desiredEnabled: boolean, operationId: string, failure: unknown) {
    const appliedEnabled = Boolean(this.dependencies.extensions.installed(id)?.enabled)
    try {
      return this.dependencies.store.repair(id, operationId, appliedEnabled, failure)
    } catch (persistenceError) {
      return {
        id,
        desiredEnabled,
        appliedEnabled,
        phase: 'repair_required' as const,
        pending: true,
        error: `${message(failure)}; repair state could not be persisted: ${message(persistenceError)}`,
      }
    }
  }

  private async repair(id: string, desiredEnabled: boolean, previousApplied: boolean, operationId: string, transitionError: unknown) {
    let failure = transitionError
    try {
      await this.rollback(id, previousApplied)
    } catch (rollbackError) {
      failure = new Error(`${message(transitionError)}; rollback failed: ${message(rollbackError)}`)
    }
    const repair = this.persistRepair(id, desiredEnabled, operationId, failure)
    try {
      this.dependencies.notify('extensions_updated')
    } catch {}
    return { ...repair, ok: false }
  }

  private async transition(id: string, desiredEnabled: boolean): Promise<ExtensionTransitionResult> {
    const installed = this.dependencies.extensions.installed(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    const current = this.state(id)!
    if (!current.pending && current.appliedEnabled === desiredEnabled) return { ...current, ok: true }

    const previousApplied = installed.enabled
    let operationId: string
    try {
      operationId = this.dependencies.store.begin(id, desiredEnabled)
    } catch (error) {
      return { ...current, ok: false, error: `Could not persist desired state: ${message(error)}` }
    }
    try {
      return await this.apply(id, desiredEnabled, operationId)
    } catch (error) {
      return this.repair(id, desiredEnabled, previousApplied, operationId, error)
    }
  }
}

export async function startExtensionState(
  store: ExtensionStateStore,
  extensions: ExtensionRegistry,
  syncTriggers: () => Promise<void>,
  cache: ExtensionCacheStore,
  notify: (reason: string) => void,
) {
  const coordinator = new ExtensionStateCoordinator({ store, extensions, syncTriggers, cache, notify })
  coordinator.registerInstalled()
  await coordinator.reconcile()
  return coordinator
}
