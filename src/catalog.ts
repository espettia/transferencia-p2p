export type CatalogEntry = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  owner: 'local' | 'remote';
  available: boolean;
};

type StoredEntry = CatalogEntry & { blob?: Blob };

const DATABASE_NAME = 'transferencia-p2p';
const STORE_NAME = 'catalog';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listCatalog(): Promise<CatalogEntry[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error ?? new Error('No se pudo leer el catálogo.'));
    request.onsuccess = () => {
      database.close();
      resolve((request.result as StoredEntry[]).sort((a, b) => b.lastModified - a.lastModified));
    };
  });
}

export async function saveLocalFile(file: File): Promise<CatalogEntry> {
  const entry: StoredEntry = {
    id: `${crypto.randomUUID()}-local`,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
    owner: 'local',
    available: true,
    blob: file,
  };
  await saveEntry(entry);
  return entry;
}

export async function saveRemoteEntry(entry: CatalogEntry): Promise<void> {
  await saveEntry({ ...entry, owner: 'remote', available: false });
}

async function saveEntry(entry: StoredEntry): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry);
    request.onerror = () => reject(request.error ?? new Error('No se pudo guardar el catálogo.'));
    request.onsuccess = () => resolve();
  });
  database.close();
}
