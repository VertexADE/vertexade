# Local dashboard cache

SQLite remains the durable application database and the API remains the write
authority. The web client keeps a read-only RxDB projection in IndexedDB so
dashboard routes can render the last synchronized data before a network request
finishes.

For the fastest repeat startup, each collection also has a compact
`localStorage` bootstrap snapshot. React reads that small snapshot during its
first browser layout pass, before dynamically importing the larger RxDB and
Dexie runtime. IndexedDB remains the complete local projection; the bootstrap
is only a paint accelerator and is rebuilt from a successfully committed RxDB
collection.

## Data model

The local database contains two RxDB collections:

- `models` stores one document per projected entity. Documents are partitioned
  into `repositories`, `pullRequests`, `agentThreads`, `workItems`, and
  `dashboardMeta`.
- `syncState` stores the last fully applied server version.

Each model document has a stable compound identifier, its source key, source
timestamp, server ordering position, server version, and a JSON value. Job
documents deliberately omit prompts, stored review details, result text, and
log paths; those remain available from their dedicated API routes.

## Synchronization

`GET /api/read-model?since=<version>` rebuilds the projection from SQLite and
returns only collections whose content hash changed after the supplied version.
The initial response replaces each collection. Later responses normally contain
only documents that changed plus the keys that were deleted. A full replacement
is used when a browser missed an intermediate patch or the API restarted.

Server-sent dashboard events trigger a microtask-coalesced browser pull without
an artificial timer. Events received during an active request schedule exactly
one follow-up pull, so rapid updates are not lost or expanded into parallel
requests. RxDB bulk-upserts patched documents, removes deleted documents, and
advances `syncState` only after all collection writes succeed.

RxDB live queries expose the IndexedDB data as RxJS observables. React routes
therefore render the persisted cache immediately and update when replication
commits a newer collection. Opening another tab reuses the same database
through RxDB multi-instance coordination.

The dashboard, settings, setup, automation, thread, and focus surfaces consume
the versioned local read model. `GET /api/read-model?since=0` is the canonical
full snapshot path; later requests use collection patches.

## Failure behavior

- A failed pull leaves the last complete local version untouched.
- A repeat browser load paints the bootstrap snapshot first, then verifies it
  against the complete RxDB version and the API in the background.
- A process or browser restart reloads the last complete RxDB version.
- If the API restarts, its first read-model request rebuilds all projections
  from SQLite.
- Writes always go through existing API endpoints; the browser projection never
  pushes data into SQLite.
