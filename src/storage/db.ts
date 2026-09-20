/**
 * IndexedDB access layer.
 *
 * A deliberately small hand-written wrapper rather than a dependency: the whole
 * surface needed is get/put/delete/getAll plus explicit, versioned migrations.
 *
 * Schema evolution is handled by an ordered list of migrations, each of which
 * knows how to move the database from version n-1 to n. Adding a store or an
 * index means appending a migration, never editing an old one.
 */

export const DB_NAME = 'acousticlab';

/** Current schema version. Bump this and append a migration when it changes. */
export const DB_VERSION = 1;

export const STORES = {
  settings: 'settings',
  calibrationProfiles: 'calibrationProfiles',
  sessions: 'sessions',
  sessionSeries: 'sessionSeries',
  validationExperiments: 'validationExperiments',
  recordings: 'recordings',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export class StorageUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

interface Migration {
  version: number;
  describe: string;
  apply(db: IDBDatabase, transaction: IDBTransaction): void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    describe: 'Initial schema: settings, calibration profiles, sessions, series, validation, recordings',
    apply(db) {
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.calibrationProfiles)) {
        const store = db.createObjectStore(STORES.calibrationProfiles, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const store = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        store.createIndex('startedAt', 'startedAt');
        store.createIndex('incomplete', 'incomplete');
      }
      if (!db.objectStoreNames.contains(STORES.sessionSeries)) {
        db.createObjectStore(STORES.sessionSeries, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(STORES.validationExperiments)) {
        const store = db.createObjectStore(STORES.validationExperiments, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('profileId', 'profileId');
      }
      if (!db.objectStoreNames.contains(STORES.recordings)) {
        const store = db.createObjectStore(STORES.recordings, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('sessionId', 'sessionId');
      }
    },
  },
];

let dbPromise: Promise<IDBDatabase> | null = null;

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new StorageUnavailableError(
      'This browser does not expose IndexedDB, so measurements cannot be saved. Private browsing modes sometimes block it.'
    );
  }
  return indexedDB;
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = requireIndexedDb().open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new StorageUnavailableError('Could not open the local database.', error));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) return;
      const from = event.oldVersion;
      for (const migration of MIGRATIONS) {
        if (migration.version > from && migration.version <= DB_VERSION) {
          migration.apply(db, transaction);
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        // Another tab upgraded the schema; close so it is not blocked.
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(
        new StorageUnavailableError(
          `Could not open the local database: ${request.error?.message ?? 'unknown error'}`,
          request.error
        )
      );
    };

    request.onblocked = () => {
      reject(
        new StorageUnavailableError(
          'The local database is blocked by another open AcousticLab tab. Close other tabs and reload.'
        )
      );
    };
  });

  return dbPromise;
}

/** Close the cached connection (used by tests and by "delete all data"). */
export function closeDatabase(): void {
  if (!dbPromise) return;
  void dbPromise.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

function runTransaction<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(stores, mode);
        let result: T;
        let settled = false;

        transaction.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        };
        transaction.onerror = () => {
          if (!settled) {
            settled = true;
            reject(transaction.error ?? new Error('IndexedDB transaction failed'));
          }
        };
        transaction.onabort = () => {
          if (!settled) {
            settled = true;
            reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
          }
        };

        Promise.resolve(work(transaction))
          .then((value) => {
            result = value;
          })
          .catch((error) => {
            settled = true;
            try {
              transaction.abort();
            } catch {
              /* already finished */
            }
            reject(error);
          });
      })
  );
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  await runTransaction(store, 'readwrite', (transaction) =>
    wrap(transaction.objectStore(store).put(value))
  );
}

export async function putMany<T>(store: StoreName, values: readonly T[]): Promise<void> {
  await runTransaction(store, 'readwrite', async (transaction) => {
    const objectStore = transaction.objectStore(store);
    for (const value of values) await wrap(objectStore.put(value));
  });
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return runTransaction(store, 'readonly', (transaction) =>
    wrap<T | undefined>(transaction.objectStore(store).get(key) as IDBRequest<T | undefined>)
  );
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return runTransaction(store, 'readonly', (transaction) =>
    wrap<T[]>(transaction.objectStore(store).getAll() as IDBRequest<T[]>)
  );
}

export function getAllByIndex<T>(
  store: StoreName,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  return runTransaction(store, 'readonly', (transaction) =>
    wrap<T[]>(transaction.objectStore(store).index(indexName).getAll(query) as IDBRequest<T[]>)
  );
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  await runTransaction(store, 'readwrite', (transaction) =>
    wrap(transaction.objectStore(store).delete(key))
  );
}

export async function clear(store: StoreName): Promise<void> {
  await runTransaction(store, 'readwrite', (transaction) =>
    wrap(transaction.objectStore(store).clear())
  );
}

export function count(store: StoreName): Promise<number> {
  return runTransaction(store, 'readonly', (transaction) =>
    wrap(transaction.objectStore(store).count())
  );
}

/** Delete records across several stores in one atomic transaction. */
export async function removeAcross(
  entries: ReadonlyArray<{ store: StoreName; key: IDBValidKey }>
): Promise<void> {
  if (entries.length === 0) return;
  const stores = [...new Set(entries.map((e) => e.store))];
  await runTransaction(stores, 'readwrite', async (transaction) => {
    for (const entry of entries) {
      await wrap(transaction.objectStore(entry.store).delete(entry.key));
    }
  });
}

export interface StorageUsage {
  /** Bytes used, as reported by the Storage API. Null when unsupported. */
  usageBytes: number | null;
  /** Bytes available, as reported by the Storage API. Null when unsupported. */
  quotaBytes: number | null
  /** Whether storage has been marked persistent by the browser. */
  persisted: boolean | null;
  counts: Record<StoreName, number>;
}

export async function storageUsage(): Promise<StorageUsage> {
  const counts = {} as Record<StoreName, number>;
  for (const store of Object.values(STORES)) {
    counts[store] = await count(store).catch(() => 0);
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    } catch {
      /* not available */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    persisted = await navigator.storage.persisted().catch(() => null);
  }

  return { usageBytes, quotaBytes, persisted, counts };
}

/**
 * Ask the browser to make storage persistent so that measurement data is not
 * evicted under storage pressure. Best effort; browsers may decline.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Delete every AcousticLab store. */
export async function clearAllData(): Promise<void> {
  for (const store of Object.values(STORES)) {
    await clear(store);
  }
}

/** Drop the whole database (used by "delete all data" for a clean slate). */
export function deleteDatabase(): Promise<void> {
  closeDatabase();
  return new Promise((resolve, reject) => {
    const request = requireIndexedDb().deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete the database'));
    request.onblocked = () => resolve();
  });
}
