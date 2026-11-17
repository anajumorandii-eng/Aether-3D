// Biblioteca local: guarda os arquivos de áudio importados no próprio aparelho (IndexedDB),
// para não precisar importar de novo ao reabrir o app.

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  blob: Blob;
  addedAt: number;
}

const DB_NAME = 'aether-3d';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Gravação cancelada'));
    };
  });
}

export async function loadStoredFiles(): Promise<StoredFile[]> {
  try {
    const all = (await run<StoredFile[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>)) ?? [];
    return all.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

export async function saveStoredFiles(files: StoredFile[]): Promise<void> {
  await run('readwrite', (s) => {
    files.forEach((f) => s.put(f));
  });
}

export async function deleteStoredFile(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** Pede ao navegador para não apagar a biblioteca quando faltar espaço. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.();
    }
  } catch {
    /* sem suporte: segue normalmente */
  }
}
