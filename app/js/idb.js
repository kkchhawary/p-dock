// Device ke andar ki storage (IndexedDB). Yahan bhi sab encrypted hi rakha jaata hai.
const DB_NAME = 'p-dock';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kvGet = (k) => run('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => run('kv', 'readwrite', (s) => s.delete(k));
export const fileGet = (k) => run('files', 'readonly', (s) => s.get(k));
export const fileSet = (k, v) => run('files', 'readwrite', (s) => s.put(v, k));
export const fileDel = (k) => run('files', 'readwrite', (s) => s.delete(k));
export const fileKeys = () => run('files', 'readonly', (s) => s.getAllKeys());

// "Is device se sab mitao" ke liye
export async function wipeDevice() {
  await run('kv', 'readwrite', (s) => s.clear());
  await run('files', 'readwrite', (s) => s.clear());
}
