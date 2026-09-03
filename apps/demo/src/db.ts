/**
 * Minimal key/value store.
 *
 * Everything the demo knows about a person lives here, on their own device.
 * Nothing is ever uploaded: the only thing that leaves a device is a QR code
 * the user physically holds up.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A MEMORY FALLBACK
 * ---------------------------------------------------------------------------
 * Hardened browsers restrict site storage. On GrapheneOS (Vanadium, and Chrome
 * with site data blocked) `indexedDB.open` throws `SecurityError: The user
 * denied permission to access the database.` The previous version let that
 * reject out of `boot()`, which rendered nothing at all: a black page with no
 * message, on a phone, in front of an audience.
 *
 * A five-minute demo does not need persistence. It needs to RENDER. So an
 * unavailable IndexedDB degrades to an in-process Map, the demo runs normally
 * for the length of the visit, and `storageIsEphemeral()` lets the UI say so
 * out loud rather than quietly pretending the state was saved.
 */

const DB_NAME = 'wot-demo'
const DB_VERSION = 1
const STORE = 'kv'

/** A backend is chosen once, on first use, and never re-probed. */
interface Backend {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  clear(): Promise<void>
  ephemeral: boolean
}

let backendP: Promise<Backend> | null = null

function memoryBackend(): Backend {
  const map = new Map<string, unknown>()
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v) },
    del: async (k) => { map.delete(k) },
    clear: async () => { map.clear() },
    ephemeral: true,
  }
}

/**
 * Open IndexedDB. Rejects (rather than throws) on every failure mode so the
 * caller has exactly one thing to catch: `indexedDB` missing entirely, the
 * getter itself throwing (blocked site data), `onerror`, or `onblocked`.
 */
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let idb: IDBFactory | undefined
    try {
      idb = globalThis.indexedDB
    } catch (err) {
      reject(err) // hardened browsers throw on the property access itself
      return
    }
    if (!idb) {
      reject(new Error('indexedDB unavailable'))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = idb.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onblocked = () => reject(new Error('indexeddb blocked'))
  })
}

function idbBackend(db: IDBDatabase): Backend {
  const tx = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | null): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve((req ? req.result : undefined) as T)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error ?? new Error('indexeddb transaction aborted'))
    })
  return {
    get: (k) => tx<unknown>('readonly', (s) => s.get(k)),
    set: async (k, v) => { await tx('readwrite', (s) => s.put(v, k)) },
    del: async (k) => { await tx('readwrite', (s) => s.delete(k)) },
    clear: async () => { await tx('readwrite', (s) => s.clear()) },
    ephemeral: false,
  }
}

let ephemeral = false

function backend(): Promise<Backend> {
  if (backendP) return backendP
  backendP = openIdb().then(
    (db) => idbBackend(db),
    () => { ephemeral = true; return memoryBackend() },
  )
  return backendP
}

/**
 * True once the store has fallen back to memory. Meaningful only after the
 * first store call has resolved (i.e. any time after `loadState()` in boot),
 * which is the only place the UI reads it.
 */
export function storageIsEphemeral(): boolean {
  return ephemeral
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const b = await backend()
  try {
    return (await b.get(key)) as T | undefined
  } catch {
    return undefined // a read failure must never be fatal; treat as "nothing stored"
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const b = await backend()
  try {
    await b.set(key, value)
  } catch {
    /* a write we cannot make is not worth ending the demo over */
  }
}

export async function kvDel(key: string): Promise<void> {
  const b = await backend()
  try { await b.del(key) } catch { /* see kvSet */ }
}

/** Wipe everything. Used by the 60-second demo reset. */
export async function kvClear(): Promise<void> {
  const b = await backend()
  try { await b.clear() } catch { /* see kvSet */ }
  try { localStorage.clear() } catch { /* private mode */ }
}
