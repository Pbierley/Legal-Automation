export type StoredForm = {
  code: string
  formName: string
  fileName: string
  mimeType: string
  byteSize: number
  fetchedAt: string
  origin: "fetched" | "uploaded"
  sourceUrl: string
  blob: Blob
}

const DB_NAME = "legal-automation"
const STORE = "forms"
const VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "code" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = fn(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

export function listStored(): Promise<StoredForm[]> {
  return run("readonly", (store) => store.getAll())
}

export function saveStored(form: StoredForm): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(form))
}

export function deleteStored(code: string): Promise<undefined> {
  return run("readwrite", (store) => store.delete(code))
}

export function clearStored(): Promise<undefined> {
  return run("readwrite", (store) => store.clear())
}
