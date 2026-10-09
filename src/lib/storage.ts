import type { AppData } from '../types';
import { createInitialData } from '../data/seeds';
import { validateAppData } from './backup';

const DATABASE = 'my-recipe-cookbook';
const STORE = 'app-data';
const RECORD = 'cookbook';

export interface StoredCookbook {
  revision: number;
  data: AppData;
}

export class StorageConflictError extends Error {
  constructor() {
    super('另一個分頁已更新食譜庫。為避免覆蓋最新資料，目前修改仍保留在此分頁；請先匯出備份，再重新讀取最新資料。');
    this.name = 'StorageConflictError';
  }
}

/** Revision zero is reserved for the old, unwrapped AppData record. */
export function decodeStoredRecord(value: unknown): StoredCookbook {
  if (typeof value === 'object' && value !== null && ('revision' in value || 'data' in value)) {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'data') || !Object.hasOwn(record, 'revision') ||
      typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 1) {
      throw new Error('本機資料庫的版本記錄不正確，原有資料已保留。');
    }
    return { revision: record.revision, data: validateAppData(record.data) };
  }
  return { revision: 0, data: validateAppData(value) };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('這個瀏覽器不支援本機資料庫。')); return; }
    let settled = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => { settled = true; reject(request.error ?? new Error('無法開啟本機資料庫。')); };
    request.onblocked = () => { settled = true; reject(new Error('資料庫正在另一個分頁使用中，請關閉其他食譜庫分頁後重試。')); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** The read and first-ever seed insertion share a transaction, including in React Strict Mode. */
export async function loadStoredData(): Promise<StoredCookbook> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredCookbook>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      let record: StoredCookbook | undefined;
      let validationError: unknown;
      const request = store.get(RECORD);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            record = { revision: 1, data: createInitialData() };
            store.put(record, RECORD);
          } else {
            record = decodeStoredRecord(request.result);
            if (record.revision === 0) {
              record.revision = 1;
              store.put(record, RECORD);
            }
          }
        } catch (error) { validationError = error; transaction.abort(); }
      };
      transaction.oncomplete = () => record ? resolve(record) : reject(new Error('未能讀取食譜資料。'));
      transaction.onerror = () => reject(validationError ?? transaction.error ?? new Error('讀取本機資料時發生錯誤。'));
      transaction.onabort = () => reject(validationError ?? transaction.error ?? new Error('本機資料讀取中斷。'));
    });
  } finally { database.close(); }
}

/** Compare-and-swap and replacement share one transaction across all tabs. */
export async function saveStoredData(data: AppData, expectedRevision: number): Promise<number> {
  const validated = validateAppData(data);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('本機資料庫版本無效，請先匯出備份並重新讀取資料。');
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      let operationError: unknown;
      const request = store.get(RECORD);
      request.onsuccess = () => {
        try {
          if (request.result === undefined || decodeStoredRecord(request.result).revision !== expectedRevision) throw new StorageConflictError();
          store.put({ revision: expectedRevision + 1, data: validated } satisfies StoredCookbook, RECORD);
        } catch (error) { operationError = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(expectedRevision + 1);
      transaction.onerror = () => reject(operationError ?? transaction.error ?? new Error('未能儲存食譜資料。'));
      transaction.onabort = () => reject(operationError ?? transaction.error ?? new Error('本機資料儲存中斷。'));
    });
  } finally { database.close(); }
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '本機儲存空間不足。目前修改仍在此分頁，請先匯出備份、騰出空間，再按「重試儲存」。';
  if (error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name)) return '瀏覽器不允許存取本機資料庫，請允許網站儲存資料後重試。';
  return error instanceof Error ? error.message : '本機資料庫暫時無法使用，請重試。';
}
