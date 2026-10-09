import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialData } from '../data/seeds';
import { MAX_BACKUP_BYTES } from './backup';
import {
  FOLDER_FILE, FOLDER_PREVIOUS_FILE, FolderConflictError, folderErrorMessage,
  hasFolderPermission, isLocalFolderSupported, loadFolder, parseFolderContent,
  pickLocalFolder, requestFolderPermission, saveFolder, type LocalDirectoryHandle,
} from './local-folder';

function envelope(): string {
  return JSON.stringify({
    format: 'my-recipe-cookbook-folder', version: 1,
    revision: 'b9f6be24-a27a-4d52-a8b7-a30daaa458c4',
    updatedAt: '2026-10-09T12:00:00.000Z', data: createInitialData(),
  }, null, 2);
}

/** Mirrors native streams: writes stage separately, close commits, abort discards. */
class MemoryDirectory implements LocalDirectoryHandle {
  readonly kind = 'directory';
  readonly name = '我的食譜';
  files = new Map<string, string>();
  permission: PermissionState = 'granted';
  aborts = 0;
  writes: string[] = [];
  readError: Error | undefined;
  failWriteTo: string | undefined;
  failCloseTo: string | undefined;
  oversizedFile = false;
  onWrite: ((name: string) => void) | undefined;
  queryPermission = vi.fn(async () => this.permission);
  requestPermission = vi.fn(async () => this.permission);

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.readError) throw this.readError;
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(name, '');
    }
    return {
      getFile: async () => {
        if (!this.files.has(name)) throw new DOMException('missing', 'NotFoundError');
        const file = new File([this.files.get(name)!], name, { type: 'application/json' });
        if (this.oversizedFile) Object.defineProperty(file, 'size', { value: MAX_BACKUP_BYTES + 1 });
        return file;
      },
      createWritable: async () => {
        let staged = '';
        return {
          write: async (content: string) => {
            if (name === this.failWriteTo) throw new DOMException('disk full', 'QuotaExceededError');
            staged = content;
            this.writes.push(name);
            this.onWrite?.(name);
          },
          close: async () => {
            if (name === this.failCloseTo) throw new Error('disk close failed');
            this.files.set(name, staged);
          },
          abort: async () => { this.aborts++; },
        };
      },
    };
  }
}

beforeEach(() => {
  let queue: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, callback: () => Promise<unknown>) => {
        const next = queue.then(callback, callback);
        queue = next.catch(() => undefined);
        return next;
      },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('本機食譜資料夾', () => {
  it('首次建立可重新讀取的完整檔案，之後更新自動保留上一版', async () => {
    const directory = new MemoryDirectory();
    const original = createInitialData();
    expect(await loadFolder(directory)).toBeNull();
    const first = await saveFolder(directory, original, null);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadFolder(directory)).toEqual(first);
    expect(directory.files.has(FOLDER_PREVIOUS_FILE)).toBe(false);
    const firstContent = directory.files.get(FOLDER_FILE)!;
    const changed = structuredClone(original);
    changed.recipes[0].title = '本機新增內容';
    const second = await saveFolder(directory, changed, first.fingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(await loadFolder(directory)).toEqual(second);
    expect(directory.files.get(FOLDER_PREVIOUS_FILE)).toBe(firstContent);
    expect(parseFolderContent(directory.files.get(FOLDER_PREVIOUS_FILE)!)).toEqual(original);
    expect(directory.requestPermission).not.toHaveBeenCalled();
  });

  it('同一舊版本的兩個分頁同時寫入，只有第一個成功', async () => {
    const directory = new MemoryDirectory();
    const first = await saveFolder(directory, createInitialData(), null);
    const left = structuredClone(first.data);
    const right = structuredClone(first.data);
    left.recipes[0].title = '第一個分頁';
    right.recipes[0].title = '第二個分頁';
    const outcomes = await Promise.allSettled([
      saveFolder(directory, left, first.fingerprint),
      saveFolder(directory, right, first.fingerprint),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { name: 'FolderConflictError' } });
    expect((await loadFolder(directory))?.data.recipes[0].title).toBe('第一個分頁');
  });

  it('外部程式修改內容但沒有改 revision，仍偵測到衝突並保留檔案', async () => {
    const directory = new MemoryDirectory();
    const original = await saveFolder(directory, createInitialData(), null);
    const externallyEdited = JSON.parse(directory.files.get(FOLDER_FILE)!);
    externallyEdited.data.recipes[0].title = '其他程式的修改';
    const externalContent = JSON.stringify(externallyEdited);
    directory.files.set(FOLDER_FILE, externalContent);
    await expect(saveFolder(directory, original.data, original.fingerprint)).rejects.toBeInstanceOf(FolderConflictError);
    expect(directory.files.get(FOLDER_FILE)).toBe(externalContent);
    expect(directory.files.has(FOLDER_PREVIOUS_FILE)).toBe(false);
  });

  it('被刪除的舊檔案不會被示範食譜重新建立', async () => {
    const directory = new MemoryDirectory();
    const original = await saveFolder(directory, createInitialData(), null);
    directory.files.delete(FOLDER_FILE);
    await expect(saveFolder(directory, original.data, original.fingerprint)).rejects.toBeInstanceOf(FolderConflictError);
    expect(directory.files.has(FOLDER_FILE)).toBe(false);
  });

  it('只有檔案不存在回傳 null，損壞、权限和 IO 錯誤都拋出', async () => {
    const directory = new MemoryDirectory();
    directory.files.set(FOLDER_FILE, '{ bad JSON');
    await expect(loadFolder(directory)).rejects.toThrow('JSON 已損壞');
    await expect(saveFolder(directory, createInitialData(), null)).rejects.toThrow('JSON 已損壞');
    expect(directory.files.get(FOLDER_FILE)).toBe('{ bad JSON');
    expect(directory.files.has(FOLDER_PREVIOUS_FILE)).toBe(false);
    directory.readError = new DOMException('denied', 'NotAllowedError');
    await expect(loadFolder(directory)).rejects.toMatchObject({ name: 'NotAllowedError' });
    directory.readError = new Error('device disconnected');
    await expect(loadFolder(directory)).rejects.toThrow('device disconnected');
  });

  it('拒絕未知格式／版本／額外欄位和不合法食譜，支援 UTF-8 BOM', () => {
    const valid = envelope();
    expect(parseFolderContent(`\uFEFF${valid}`)).toEqual(JSON.parse(valid).data);
    for (const patch of [{ format: 'other' }, { version: 2 }, { extra: true }, { revision: 'same' }, { updatedAt: 'yesterday' }]) {
      expect(() => parseFolderContent(JSON.stringify({ ...JSON.parse(valid), ...patch }))).toThrow('格式不正確');
    }
    const corrupt = JSON.parse(valid);
    corrupt.data.recipes[0].categoryId = 'missing';
    expect(() => parseFolderContent(JSON.stringify(corrupt))).toThrow('分類不存在');
    expect(() => parseFolderContent(JSON.stringify(createInitialData()))).toThrow('格式不正確');
  });

  it('寫入或 close 失敗均保留原有 main，並可從上一版還原', async () => {
    for (const failure of ['write', 'close']) {
      const directory = new MemoryDirectory();
      const original = await saveFolder(directory, createInitialData(), null);
      const originalContent = directory.files.get(FOLDER_FILE)!;
      if (failure === 'write') directory.failWriteTo = FOLDER_FILE;
      else directory.failCloseTo = FOLDER_FILE;
      const changed = structuredClone(original.data);
      changed.recipes[0].title = '不應提交的修改';
      await expect(saveFolder(directory, changed, original.fingerprint)).rejects.toThrow();
      expect(directory.files.get(FOLDER_FILE)).toBe(originalContent);
      expect(directory.files.get(FOLDER_PREVIOUS_FILE)).toBe(originalContent);
      expect(directory.aborts).toBe(1);
    }
  });

  it('上一版備份寫入失敗時不提交 main，防止失去恢復副本', async () => {
    const directory = new MemoryDirectory();
    const original = await saveFolder(directory, createInitialData(), null);
    const originalContent = directory.files.get(FOLDER_FILE)!;
    directory.failWriteTo = FOLDER_PREVIOUS_FILE;
    await expect(saveFolder(directory, original.data, original.fingerprint)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(directory.files.get(FOLDER_FILE)).toBe(originalContent);
    expect(directory.writes.filter(name => name === FOLDER_FILE)).toHaveLength(1);
  });

  it('儲存前權限已撤銷則不建立或修改任何檔案，也不自動彈出授權', async () => {
    const directory = new MemoryDirectory();
    directory.permission = 'denied';
    expect(await hasFolderPermission(directory)).toBe(false);
    await expect(saveFolder(directory, createInitialData(), null)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(directory.files.size).toBe(0);
    expect(directory.requestPermission).not.toHaveBeenCalled();
    directory.permission = 'granted';
    expect(await requestFolderPermission(directory)).toBe(true);
    expect(directory.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('儲存途中權限撤銷會 abort，既有 main 不變', async () => {
    const directory = new MemoryDirectory();
    const original = await saveFolder(directory, createInitialData(), null);
    const originalContent = directory.files.get(FOLDER_FILE)!;
    directory.onWrite = name => { if (name === FOLDER_FILE) directory.permission = 'denied'; };
    await expect(saveFolder(directory, original.data, original.fingerprint)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(directory.files.get(FOLDER_FILE)).toBe(originalContent);
    expect(directory.aborts).toBe(1);
  });

  it('main 已寫入暫存後外部編輯，close 前再檢查並 abort 以保留編輯', async () => {
    const directory = new MemoryDirectory();
    const original = await saveFolder(directory, createInitialData(), null);
    let externalContent = '';
    directory.onWrite = name => {
      if (name !== FOLDER_FILE) return;
      const edited = JSON.parse(directory.files.get(FOLDER_FILE)!);
      edited.data.recipes[0].notes = '在寫入期間被其他程式修改';
      externalContent = JSON.stringify(edited);
      directory.files.set(FOLDER_FILE, externalContent);
    };
    await expect(saveFolder(directory, original.data, original.fingerprint)).rejects.toBeInstanceOf(FolderConflictError);
    expect(directory.files.get(FOLDER_FILE)).toBe(externalContent);
    expect(directory.aborts).toBe(1);
  });

  it('在首次暫存寫入時外部加入 main，不能覆蓋新檔案', async () => {
    const directory = new MemoryDirectory();
    const externalContent = envelope();
    directory.onWrite = name => { if (name === FOLDER_FILE) directory.files.set(FOLDER_FILE, externalContent); };
    await expect(saveFolder(directory, createInitialData(), null)).rejects.toBeInstanceOf(FolderConflictError);
    expect(directory.files.get(FOLDER_FILE)).toBe(externalContent);
    expect(directory.aborts).toBe(1);
  });

  it('檔案超過大小限制時在讀取文字前拒絕，不會改寫', async () => {
    const directory = new MemoryDirectory();
    const content = envelope();
    directory.files.set(FOLDER_FILE, content);
    directory.oversizedFile = true;
    await expect(loadFolder(directory)).rejects.toThrow('超過 50 MB');
    await expect(saveFolder(directory, createInitialData(), null)).rejects.toThrow('超過 50 MB');
    expect(directory.files.get(FOLDER_FILE)).toBe(content);
    expect(directory.writes).toHaveLength(0);
  });

  it('安全環境及 native API 齊備才提供 picker，取消不會建立資料', async () => {
    const directory = new MemoryDirectory();
    const picker = vi.fn(async () => directory);
    vi.stubGlobal('window', { isSecureContext: true, showDirectoryPicker: picker });
    expect(isLocalFolderSupported()).toBe(true);
    expect(await pickLocalFolder()).toBe(directory);
    expect(picker).toHaveBeenCalledWith({ id: 'my-recipe-cookbook', mode: 'readwrite' });
    picker.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    await expect(pickLocalFolder()).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('window', { isSecureContext: false, showDirectoryPicker: picker });
    expect(isLocalFolderSupported()).toBe(false);
    await expect(pickLocalFolder()).rejects.toThrow('Chrome 或 Edge');
    vi.stubGlobal('window', { isSecureContext: true });
    expect(isLocalFolderSupported()).toBe(false);
  });

  it('錯誤訊息分別解釋權限、空間、取消、鎖定、衝突並保留修改', () => {
    for (const name of ['NotAllowedError', 'QuotaExceededError', 'AbortError', 'NoModificationAllowedError', 'NotFoundError']) {
      expect(folderErrorMessage(new DOMException('native error', name))).toContain('仍保留');
    }
    expect(folderErrorMessage(new FolderConflictError())).toContain('避免覆蓋');
    expect(folderErrorMessage(new Error('驗證失敗'))).toBe('驗證失敗');
  });
});
