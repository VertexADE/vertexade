import { createRxDatabase, type RxCollection, type RxDatabase, type RxJsonSchema } from 'rxdb/plugins/core'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import {
  dashboardCollections,
  dashboardProjectionPolicies,
  type DashboardCacheDocument,
  type DashboardCollection,
  type DashboardSyncDocument,
  type ReadModelEntry,
  type ReadModelUpdate,
} from './dashboard-cache-model'
import { dashboardHash } from './rxdb-dashboard-hash'

type DashboardCacheCollections = {
  models: RxCollection<DashboardCacheDocument>
  syncState: RxCollection<DashboardSyncDocument>
  portableSources: RxCollection<PortableSourceDocument>
}

type PortableSourceDocument = {
  id: string
  data: Record<string, unknown>
  syncedAt: string
}

const modelSchema: RxJsonSchema<DashboardCacheDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 500 },
    bucket: { type: 'string', enum: [...dashboardCollections], maxLength: 32 },
    key: { type: 'string', maxLength: 400 },
    value: { type: 'object', additionalProperties: true },
    sourceUpdatedAt: { type: ['string', 'null'] },
    position: { type: 'number', minimum: 0, multipleOf: 1 },
    serverVersion: { type: 'number', minimum: 0, multipleOf: 1 },
  },
  required: ['id', 'bucket', 'key', 'value', 'sourceUpdatedAt', 'position', 'serverVersion'],
  indexes: ['bucket', ['bucket', 'position']],
}

const syncSchema: RxJsonSchema<DashboardSyncDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 20 },
    instanceId: { type: 'string', maxLength: 80 },
    version: { type: 'number', minimum: 0, multipleOf: 1 },
    syncedAt: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'instanceId', 'version', 'syncedAt'],
}

const portableSourceSchema: RxJsonSchema<PortableSourceDocument> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 500 },
    data: { type: 'object', additionalProperties: true },
    syncedAt: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'data', 'syncedAt'],
}

let databasePromise: Promise<RxDatabase<DashboardCacheCollections>> | undefined

function database() {
  if (databasePromise === undefined) {
    databasePromise = createRxDatabase<DashboardCacheCollections>({
      name: 'vertexade_dashboard_v5',
      storage: getRxStorageDexie(),
      multiInstance: true,
      eventReduce: true,
      closeDuplicates: true,
      hashFunction: dashboardHash,
    }).then(async (db) => {
      await db.addCollections({
        models: { schema: modelSchema },
        syncState: { schema: syncSchema },
        portableSources: { schema: portableSourceSchema },
      })
      return db
    })
  }
  return databasePromise
}

function storageError(action: string, errors: unknown[]) {
  const detail = errors[0]
  let rendered = ''
  try {
    rendered = JSON.stringify(detail)
  } catch {
    rendered = String(detail)
  }
  return new Error(`${action}: ${rendered}`)
}

function cacheDocument(collection: DashboardCollection, entry: ReadModelEntry, serverVersion: number): DashboardCacheDocument {
  return {
    id: `${collection}:${entry.key}`,
    bucket: collection,
    key: entry.key,
    value: entry.value,
    sourceUpdatedAt: entry.sourceUpdatedAt,
    position: entry.position,
    serverVersion,
  }
}

async function removeDocuments(db: RxDatabase<DashboardCacheCollections>, collection: DashboardCollection, keys: string[]) {
  if (!keys.length) return
  const documents = await db.models.findByIds(keys.map((key) => `${collection}:${key}`)).exec()
  if (!documents.size) return
  const result = await db.models.bulkRemove([...documents.values()])
  if (result.error.length) {
    throw storageError(`Could not remove stale ${collection} cache entries`, result.error)
  }
}

async function replaceCollection(db: RxDatabase<DashboardCacheCollections>, collection: DashboardCollection, update: ReadModelUpdate) {
  const entries = update.entries ?? []
  const current = await db.models.find({ selector: { bucket: collection } }).exec()
  const expectedIds = new Set(entries.map((entry) => `${collection}:${entry.key}`))
  const removed = current.filter((document) => !expectedIds.has(document.id))
  if (removed.length) {
    const result = await db.models.bulkRemove(removed)
    if (result.error.length) {
      throw storageError(`Could not replace stale ${collection} cache entries`, result.error)
    }
  }
  if (entries.length) {
    const result = await db.models.bulkUpsert(entries.map((entry) => cacheDocument(collection, entry, update.version)))
    if (result.error.length) {
      throw storageError(`Could not store ${collection} cache entries`, result.error)
    }
  }
}

async function patchCollection(db: RxDatabase<DashboardCacheCollections>, collection: DashboardCollection, update: ReadModelUpdate) {
  await removeDocuments(db, collection, update.deletes ?? [])
  const upserts = update.upserts ?? []
  if (!upserts.length) return
  const result = await db.models.bulkUpsert(upserts.map((entry) => cacheDocument(collection, entry, update.version)))
  if (result.error.length) {
    throw storageError(`Could not patch ${collection} cache entries`, result.error)
  }
}

// fallow-ignore-next-line unused-export -- called through the lazy RxDB storage adapter boundary.
export async function applyDashboardUpdate(collection: DashboardCollection, update: ReadModelUpdate) {
  if (dashboardProjectionPolicies[collection].storage !== 'persistent') {
    throw new Error(`${collection} is not approved for persistent storage`)
  }
  const db = await database()
  if (update.mode === 'patch') {
    await patchCollection(db, collection, update)
  } else {
    await replaceCollection(db, collection, update)
  }
}

// fallow-ignore-next-line unused-export -- called through the lazy RxDB storage adapter boundary.
export async function readDashboardCollection(collection: DashboardCollection) {
  const db = await database()
  const documents = await db.models
    .find({
      selector: { bucket: collection },
      sort: [{ position: 'asc' }],
    })
    .exec()
  return documents.map((document) => document.value)
}

// fallow-ignore-next-line unused-export -- called through the lazy RxDB storage adapter boundary.
export async function readDashboardSyncState() {
  const db = await database()
  return db.syncState.findOne('dashboard').exec()
}

// fallow-ignore-next-line unused-export -- called through the lazy RxDB storage adapter boundary.
export async function writeDashboardSyncState(instanceId: string, version: number, syncedAt: string) {
  const db = await database()
  await db.syncState.upsert({ id: 'dashboard', instanceId, version, syncedAt })
}

// fallow-ignore-next-line unused-export -- called through the lazy RxDB storage adapter boundary.
export async function subscribeDashboardCollection(collection: DashboardCollection, listener: (values: Record<string, unknown>[]) => void) {
  const db = await database()
  let revision = 0
  return db.syncState.findOne('dashboard').$.subscribe((syncState) => {
    if (!syncState) return
    const currentRevision = ++revision
    void readDashboardCollection(collection).then((values) => {
      if (currentRevision === revision) listener(values)
    })
  })
}

// fallow-ignore-next-line unused-export -- called through the lazy extension surface cache adapter.
export async function readPortableSource(key: string) {
  const document = await (await database()).portableSources.findOne(key).exec()
  return document ? { data: document.data, syncedAt: document.syncedAt } : null
}

// fallow-ignore-next-line unused-export -- called through the lazy extension surface cache adapter.
export async function writePortableSource(key: string, data: Record<string, unknown>, syncedAt: string) {
  await (await database()).portableSources.upsert({ id: key, data, syncedAt })
}
