import { z } from 'zod';
import type { AppData } from '../types';
import { MAX_BACKUP_BYTES, validateAppData } from './backup';

export const FOLDER_FILE = 'cookbook.json';
export const FOLDER_PREVIOUS_FILE = 'cookbook.previous.json';
const HANDLE_DATABASE = 'my-recipe-cookbook-folder-link';
const HANDLE_STORE = 'settings';
const HANDLE_KEY = 'folder';
const WRITE_LOCK = 'my-recipe-cookbook-folder-write';

interface LocalFileWriter {
  write(content: string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface LocalFileHandle {
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean; mode?: 'exclusive' }): Promise<LocalFileWriter>;
}

/** Structural types also work with browser-native handles restored from IndexedDB. */
export interface LocalDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface FolderRecord {
  data: AppData;
  fingerprint: string;
  updatedAt: string;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<LocalDirectoryHandle>;
};

const envelopeSchema = z.object({
  format: z.literal('my-recipe-cookbook-folder'),
  version: z.literal(1),
  revision: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
  data: z.unknown(),
}).strict();

export class FolderConflictError extends Error {
  constructor() {
    super('本機食譜檔案已被其他分頁或程式更改、移走或刪除。為避免覆蓋最新資料，目前修改仍保留在此分頁；請先保留目前修改，再重新讀取資料夾。');
    this.name = 'FolderConflictError';
  }
}

export function isLocalFolderSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function' &&
    typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function' &&
    typeof crypto.randomUUID === 'function' && typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function';
}

/** Call directly from a click handler: the native picker needs a user gesture. */
export async function pickLocalFolder(): Promise<LocalDirectoryHandle> {
  if (!isLocalFolderSupported()) throw new Error('請使用電腦版 Chrome 或 Edge 開啟食譜庫，才能選擇本機資料夾。');
  return (window as PickerWindow).showDirectoryPicker!({ id: 'my-recipe-cookbook', mode: 'readwrite' });
}

export async function hasFolderPermission(handle: LocalDirectoryHandle): Promise<boolean> {
  return await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
}

/** Permission renewal, like the picker, must be called directly from a click. */
export async function requestFolderPermission(handle: LocalDirectoryHandle): Promise<boolean> {
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

function validateContentSize(content: string): void {
  if (content.length > MAX_BACKUP_BYTES || new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('本機食譜檔案超過 50 MB，請先減少食譜圖片大小；原有檔案已保留。');
  }
}

function decodeFolderContent(content: string): { data: AppData; updatedAt: string } {
  validateContentSize(content);
  let value: unknown;
  try { value = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('本機食譜檔案的 JSON 已損壞，原有檔案已保留，沒有覆蓋或加入示範食譜。請選擇其他資料夾或還原有效備份。'); }
  const result = envelopeSchema.safeParse(value);
  if (!result.success) throw new Error('本機食譜檔案格式不正確或版本不受支援，原有檔案已保留。');
  return { data: validateAppData(result.data.data), updatedAt: result.data.updatedAt };
}

/** Recovery/import code may decode a folder file without requiring file permission. */
export function parseFolderContent(content: string): AppData {
  return decodeFolderContent(content).data;
}

async function fingerprint(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotFoundError';
}

interface ReadFolderResult { content: string; record: FolderRecord }

async function readFolder(handle: LocalDirectoryHandle): Promise<ReadFolderResult | null> {
  await assertFolderPermission(handle);
  let file: File;
  try {
    const fileHandle = await handle.getFileHandle(FOLDER_FILE);
    file = await fileHandle.getFile();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (file.size > MAX_BACKUP_BYTES) throw new Error('本機食譜檔案超過 50 MB，原有檔案已保留。');
  const content = await file.text();
  const decoded = decodeFolderContent(content);
  return { content, record: { ...decoded, fingerprint: await fingerprint(content) } };
}

/** Null means cookbook.json is absent; permission/corruption/IO failures always throw. */
export async function loadFolder(handle: LocalDirectoryHandle): Promise<FolderRecord | null> {
  return (await readFolder(handle))?.record ?? null;
}

async function assertFolderPermission(handle: LocalDirectoryHandle): Promise<void> {
  if (!await hasFolderPermission(handle)) throw new DOMException('未獲授權編輯本機資料夾。', 'NotAllowedError');
}

async function writeFile(handle: LocalDirectoryHandle, name: string, content: string, beforeClose?: () => Promise<void>): Promise<void> {
  await assertFolderPermission(handle);
  const fileHandle = await handle.getFileHandle(name, { create: true });
  // A native writable stream commits its temporary file only when close succeeds.
  const writer = await fileHandle.createWritable({ keepExistingData: false, mode: 'exclusive' });
  try {
    await assertFolderPermission(handle);
    await writer.write(content);
    if (beforeClose) await beforeClose();
    await assertFolderPermission(handle);
    await writer.close();
  } catch (error) {
    try { await writer.abort(error); } catch { /* The stream may already be closed. */ }
    throw error;
  }
}

/**
 * Serialises same-origin tabs and compares the complete file, including manual edits.
 * The browser cannot lock an unrelated desktop program; recheck after the backup too.
 */
export async function saveFolder(handle: LocalDirectoryHandle, data: AppData, expectedFingerprint: string | null): Promise<FolderRecord> {
  if (expectedFingerprint !== null && !/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('本機食譜檔案版本無效，請重新讀取資料夾。');
  const validated = validateAppData(data);
  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') throw new Error('這個瀏覽器不支援安全的本機檔案儲存，請使用電腦版 Chrome 或 Edge。');
  return navigator.locks.request(WRITE_LOCK, async () => {
    await assertFolderPermission(handle);
    const previous = await readFolder(handle);
    if ((previous?.record.fingerprint ?? null) !== expectedFingerprint) throw new FolderConflictError();
    const updatedAt = new Date().toISOString();
    const content = `${JSON.stringify({
      format: 'my-recipe-cookbook-folder', version: 1, revision: crypto.randomUUID(), updatedAt, data: validated,
    }, null, 2)}\n`;
    validateContentSize(content);
    const record: FolderRecord = { data: validated, updatedAt, fingerprint: await fingerprint(content) };
    if (previous) await writeFile(handle, FOLDER_PREVIOUS_FILE, previous.content);
    const latest = await readFolder(handle);
    if ((latest?.record.fingerprint ?? null) !== expectedFingerprint) throw new FolderConflictError();
    await writeFile(handle, FOLDER_FILE, content, async () => {
      if (previous) {
        const beforeCommit = await readFolder(handle);
        if (beforeCommit?.record.fingerprint !== expectedFingerprint) throw new FolderConflictError();
      } else {
        // getFileHandle(create:true) creates an empty file even before its first close.
        // It must still be empty; an external writer's content must never be replaced.
        const created = await (await handle.getFileHandle(FOLDER_FILE)).getFile();
        if (created.size !== 0) throw new FolderConflictError();
      }
    });
    return record;
  });
}

function isDirectoryHandle(value: unknown): value is LocalDirectoryHandle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LocalDirectoryHandle>;
  return candidate.kind === 'directory' && typeof candidate.name === 'string' &&
    typeof candidate.getFileHandle === 'function' && typeof candidate.queryPermission === 'function' &&
    typeof candidate.requestPermission === 'function';
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('瀏覽器未能記住本機資料夾。食譜檔案仍保存在電腦；下次請重新選擇資料夾。')); return; }
    let settled = false;
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) request.result.createObjectStore(HANDLE_STORE);
    };
    request.onerror = () => { settled = true; reject(request.error ?? new Error('未能記住本機資料夾。')); };
    request.onblocked = () => { settled = true; reject(new Error('其他分頁正在使用資料夾設定，請關閉其他食譜庫分頁後重試。')); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function withHandleStore<T>(mode: IDBTransactionMode, operate: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openHandleDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, mode);
      let result: T;
      let operationError: unknown;
      try {
        const request = operate(transaction.objectStore(HANDLE_STORE));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { operationError = request.error; };
      } catch (error) { operationError = error; transaction.abort(); }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(operationError ?? transaction.error ?? new Error('未能儲存本機資料夾設定。'));
      transaction.onabort = () => reject(operationError ?? transaction.error ?? new Error('本機資料夾設定操作中斷。'));
    });
  } finally { database.close(); }
}

export async function getRememberedFolder(): Promise<LocalDirectoryHandle | null> {
  const value: unknown = await withHandleStore('readonly', store => store.get(HANDLE_KEY));
  if (value === undefined) return null;
  if (!isDirectoryHandle(value)) throw new Error('已記住的資料夾設定無法使用。食譜檔案仍保存在電腦，請重新選擇原有資料夾。');
  return value;
}

/** Store only the native handle, separately from the recipe database/cache. */
export async function rememberFolder(handle: LocalDirectoryHandle): Promise<void> {
  if (!isDirectoryHandle(handle)) throw new Error('未能記住所選的本機資料夾。');
  await withHandleStore('readwrite', store => store.put(handle, HANDLE_KEY));
}

export async function forgetFolder(): Promise<void> {
  await withHandleStore('readwrite', store => store.delete(HANDLE_KEY));
}

export function folderErrorMessage(error: unknown): string {
  if (error instanceof FolderConflictError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '操作已取消，目前修改仍保留在此分頁。';
    if (['NotAllowedError', 'SecurityError'].includes(error.name)) return '未獲授權存取本機資料夾。請按「繼續使用此資料夾」並允許編輯檔案；目前修改仍保留在此分頁。';
    if (error.name === 'NotFoundError') return '本機資料夾或檔案已被移走或刪除。請重新選擇原有資料夾；目前修改仍保留在此分頁。';
    if (error.name === 'QuotaExceededError') return '電腦儲存空間不足，未能寫入食譜檔案。請騰出空間後重試；目前修改仍保留在此分頁。';
    if (error.name === 'NoModificationAllowedError') return '食譜檔案正被另一個程式使用或未能修改。請關閉其他程式後重試；目前修改仍保留在此分頁。';
    return error.message;
  }
  return '暫時未能存取本機食譜檔案，目前修改仍保留在此分頁，請重試。';
}
