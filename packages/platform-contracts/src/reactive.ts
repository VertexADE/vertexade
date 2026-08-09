export type ReactiveProjectionStorage = 'persistent' | 'memory' | 'none'
export type ReactiveProjectionSensitivity = 'public' | 'internal' | 'sensitive'

export type ReactiveProjectionPolicy = {
  id: string
  storage: ReactiveProjectionStorage
  sensitivity: ReactiveProjectionSensitivity
  sourceOfTruth: 'server'
  allowsOfflineWrites: false
  topics: string[]
  description: string
}

export type ReactiveCheckpoint = {
  instanceId: string
  version: number
}

export type ReactivePullResult<TDocument> = {
  checkpoint: ReactiveCheckpoint
  documents: TDocument[]
  deletedIds: string[]
  replace: boolean
}

/**
 * Provider-neutral storage boundary for web RxDB and a future authenticated
 * native adapter. Platform features depend on this contract, never DOM APIs.
 */
export interface ReactiveStorageAdapter<TDocument extends { id: string }> {
  readAll(projectionId: string): Promise<TDocument[]>
  apply(projectionId: string, result: ReactivePullResult<TDocument>): Promise<void>
  checkpoint(projectionId: string): Promise<ReactiveCheckpoint | null>
  observe(projectionId: string, listener: (documents: TDocument[]) => void): () => void
}
