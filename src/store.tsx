import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData } from './types';
import { createEmptyData } from './data/seeds';
import { validateAppData } from './lib/backup';
import { loadStoredData, saveStoredData, storageErrorMessage, StorageConflictError } from './lib/storage';
import { FolderConflictError, folderErrorMessage, forgetFolder, getRememberedFolder, hasFolderPermission, isLocalFolderSupported, loadFolder, pickLocalFolder, rememberFolder, requestFolderPermission, saveFolder, type FolderRecord, type LocalDirectoryHandle } from './lib/local-folder';

export interface LocalFolderState {
  status: 'browser' | 'permission' | 'ready' | 'error' | 'unsupported';
  name: string | null;
  savedAt: string | null;
  error: string | null;
  busy: boolean;
}
export interface PendingFolder {
  name: string;
  data: AppData;
  existing: boolean;
  updatedAt: string | null;
}
export interface CookbookContextValue {
  data: AppData;
  loading: boolean;
  saveError: string | null;
  storageReady: boolean;
  saving: boolean;
  conflict: boolean;
  localFolder: LocalFolderState;
  pendingFolder: PendingFolder | null;
  chooseLocalFolder: () => Promise<void>;
  confirmLocalFolder: () => Promise<void>;
  cancelLocalFolder: () => void;
  reconnectLocalFolder: () => Promise<void>;
  returnToBrowserStorage: () => Promise<void>;
  update: (mutator: (draft: AppData) => void) => boolean;
  replaceData: (data: AppData) => boolean;
  notify: (message: string) => void;
  toast: string | null;
  retrySave: () => void;
  reloadLatest: () => void;
}

type Destination = { kind: 'browser'; revision: number } | { kind: 'folder'; handle: LocalDirectoryHandle; fingerprint: string };
const CookbookContext = createContext<CookbookContextValue | null>(null);
const defaultFolderState = (): LocalFolderState => ({ status: isLocalFolderSupported() ? 'browser' : 'unsupported', name: null, savedAt: null, error: null, busy: false });

export function CookbookProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(createEmptyData);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [localFolder, setLocalFolder] = useState<LocalFolderState>(defaultFolderState);
  const [pendingFolder, setPendingFolder] = useState<PendingFolder | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const current = useRef(data);
  const ready = useRef(false);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const saveGeneration = useRef(0);
  const destination = useRef<Destination | null>(null);
  const remembered = useRef<LocalDirectoryHandle | null>(null);
  const selection = useRef<{ handle: LocalDirectoryHandle; record: FolderRecord | null } | null>(null);
  const changingDestination = useRef(false);
  const conflicted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const unsaved = useRef(false);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast(message);
    toastTimeout.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const applyLoaded = useCallback((next: AppData, target: Destination) => {
    current.current = next;
    destination.current = target;
    setData(next);
    conflicted.current = false;
    setConflict(false);
    ready.current = true;
    setStorageReady(true);
    unsaved.current = false;
    setSaveError(null);
  }, []);

  const load = useCallback(async (allowConnectionOperation = false) => {
    if (changingDestination.current && !allowConnectionOperation) return;
    const generation = ++readGeneration.current;
    saveGeneration.current += 1;
    ready.current = false;
    setStorageReady(false);
    setLoading(true);
    setSaveError(null);
    try {
      await queue.current;
      if (!mounted.current || generation !== readGeneration.current) return;
      const handle = remembered.current || await getRememberedFolder();
      if (!mounted.current || generation !== readGeneration.current) return;
      if (handle) {
        remembered.current = handle;
        if (!isLocalFolderSupported()) {
          setLocalFolder({ status: 'unsupported', name: handle.name, savedAt: null, busy: false, error: '請以電腦版 Chrome 或 Edge 開啟，才能繼續讀取已選擇的食譜資料夾。' });
          return;
        }
        if (!await hasFolderPermission(handle)) {
          if (mounted.current && generation === readGeneration.current) setLocalFolder({ status: 'permission', name: handle.name, savedAt: null, error: null, busy: false });
          return;
        }
        const record = await loadFolder(handle);
        if (!record) throw new Error('資料夾內找不到 cookbook.json。請確認檔案仍在原來位置，或選擇已有食譜的另一個資料夾。原有資料不會被覆蓋。');
        if (!mounted.current || generation !== readGeneration.current) return;
        applyLoaded(record.data, { kind: 'folder', handle, fingerprint: record.fingerprint });
        setLocalFolder({ status: 'ready', name: handle.name, savedAt: record.updatedAt, error: null, busy: false });
      } else {
        const stored = await loadStoredData();
        if (!mounted.current || generation !== readGeneration.current) return;
        applyLoaded(stored.data, { kind: 'browser', revision: stored.revision });
        setLocalFolder(defaultFolderState());
      }
    } catch (error) {
      if (!mounted.current || generation !== readGeneration.current) return;
      const message = remembered.current ? folderErrorMessage(error) : storageErrorMessage(error);
      setSaveError(`未能讀取已有資料，已保留原本的檔案。${message}`);
      if (remembered.current) setLocalFolder(previous => ({ ...previous, status: 'error', name: remembered.current!.name, error: message, busy: false }));
    } finally {
      if (mounted.current && generation === readGeneration.current) setLoading(false);
    }
  }, [applyLoaded]);

  const persist = useCallback((next: AppData) => {
    const snapshot = structuredClone(next);
    const generation = saveGeneration.current;
    pending.current += 1;
    unsaved.current = true;
    setSaving(true);
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        if (generation !== saveGeneration.current || conflicted.current) return;
        const target = destination.current;
        if (!target) throw new Error('請先連接食譜資料夾或瀏覽器儲存。');
        if (target.kind === 'folder') {
          const record = await saveFolder(target.handle, snapshot, target.fingerprint);
          target.fingerprint = record.fingerprint;
          if (mounted.current) setLocalFolder(previous => ({ ...previous, status: 'ready', savedAt: record.updatedAt, error: null }));
        } else target.revision = await saveStoredData(snapshot, target.revision);
        if (mounted.current) setSaveError(null);
        if (pending.current === 1) unsaved.current = false;
      } catch (error) {
        unsaved.current = true;
        if (error instanceof StorageConflictError || error instanceof FolderConflictError) {
          conflicted.current = true;
          if (mounted.current) setConflict(true);
        }
        const isFolder = destination.current?.kind === 'folder';
        const message = isFolder ? folderErrorMessage(error) : storageErrorMessage(error);
        if (mounted.current) {
          setSaveError(`尚未儲存目前修改。${message}`);
          if (isFolder) setLocalFolder(previous => ({ ...previous, status: 'error', error: message }));
        }
      } finally {
        pending.current -= 1;
        if (mounted.current && pending.current === 0) setSaving(false);
      }
    });
  }, []);

  const replaceData = useCallback((next: AppData) => {
    if (conflicted.current) { notify('另一個分頁或程式已更新資料。請先匯出目前修改，再重新讀取最新資料。'); return false; }
    if (!ready.current || changingDestination.current) { notify('請先完成資料夾連接或重新讀取資料。'); return false; }
    try {
      const validated = validateAppData(next);
      current.current = validated;
      setData(validated);
      persist(validated);
      return true;
    } catch (error) {
      const message = storageErrorMessage(error);
      notify(message);
      setSaveError(`未能更新資料：${message}`);
      return false;
    }
  }, [notify, persist]);

  const update = useCallback((mutator: (draft: AppData) => void) => {
    if (conflicted.current) { notify('另一個分頁或程式已更新資料。請先匯出目前修改，再重新讀取最新資料。'); return false; }
    if (!ready.current || changingDestination.current) { notify('請先完成資料夾連接或重新讀取資料。'); return false; }
    try {
      const draft = structuredClone(current.current);
      mutator(draft);
      return replaceData(draft);
    } catch (error) { notify(storageErrorMessage(error)); return false; }
  }, [notify, replaceData]);

  const chooseLocalFolder = useCallback(async () => {
    if (changingDestination.current) return;
    changingDestination.current = true;
    readGeneration.current += 1;
    setLoading(false);
    setLocalFolder(previous => ({ ...previous, busy: true, error: null }));
    try {
      // The picker must be called before any awaits, during the button's user gesture.
      const handle = await pickLocalFolder();
      await queue.current;
      const record = await loadFolder(handle);
      if (!record && !ready.current) throw new Error('目前資料尚未讀取。請選擇已有 cookbook.json 的資料夾，避免建立空白食譜庫。');
      selection.current = { handle, record };
      setPendingFolder({ name: handle.name, data: record?.data || structuredClone(current.current), existing: !!record, updatedAt: record?.updatedAt || null });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setLocalFolder(previous => ({ ...previous, error: folderErrorMessage(error) }));
    } finally {
      changingDestination.current = false;
      setLocalFolder(previous => ({ ...previous, busy: false }));
    }
  }, []);

  const cancelLocalFolder = useCallback(() => {
    if (changingDestination.current) return;
    selection.current = null;
    setPendingFolder(null);
    setLocalFolder(previous => ({ ...previous, error: null }));
  }, []);

  const confirmLocalFolder = useCallback(async () => {
    const chosen = selection.current;
    if (!chosen || changingDestination.current) return;
    changingDestination.current = true;
    readGeneration.current += 1;
    setLoading(false);
    setLocalFolder(previous => ({ ...previous, busy: true, error: null }));
    try {
      await queue.current;
      let record: FolderRecord;
      if (chosen.record) {
        const latest = await loadFolder(chosen.handle);
        if (!latest || latest.fingerprint !== chosen.record.fingerprint) throw new Error('資料夾內容在確認前已變更。請取消並重新選擇資料夾，檢閱最新食譜。');
        record = latest;
      } else {
        if (!ready.current) throw new Error('請先讀取目前食譜，再搬到新資料夾。');
        record = await saveFolder(chosen.handle, current.current, null);
      }
      try { await rememberFolder(chosen.handle); }
      catch (error) {
        // Never activate B while startup still remembers A. A successfully created
        // file remains available for a reviewed retry, without another initial write.
        if (!chosen.record) {
          selection.current = { handle: chosen.handle, record };
          setPendingFolder({ name: chosen.handle.name, data: record.data, existing: true, updatedAt: record.updatedAt });
        }
        throw new Error(`未能記住資料夾位置，尚未切換自動儲存。${!chosen.record ? '食譜副本已存到所選資料夾；請重試連接。' : '目前使用的食譜及檔案已保留，請重試連接。'} ${storageErrorMessage(error)}`);
      }
      readGeneration.current += 1;
      saveGeneration.current += 1;
      remembered.current = chosen.handle;
      applyLoaded(record.data, { kind: 'folder', handle: chosen.handle, fingerprint: record.fingerprint });
      setLocalFolder({ status: 'ready', name: chosen.handle.name, savedAt: record.updatedAt, error: null, busy: false });
      selection.current = null;
      setPendingFolder(null);
      notify(chosen.record ? '已開啟資料夾內的食譜，之後修改會自動儲存' : '已將食譜及圖片存到資料夾，之後修改會自動儲存');
    } catch (error) {
      setLocalFolder(previous => ({ ...previous, error: folderErrorMessage(error) }));
    } finally {
      changingDestination.current = false;
      setLocalFolder(previous => ({ ...previous, busy: false }));
    }
  }, [applyLoaded, notify]);

  const reconnectLocalFolder = useCallback(async () => {
    const handle = remembered.current;
    if (!handle || changingDestination.current) return;
    changingDestination.current = true;
    readGeneration.current += 1;
    setLoading(false);
    setLocalFolder(previous => ({ ...previous, busy: true, error: null }));
    try {
      // Permission requests also require a fresh click; startup never prompts automatically.
      if (!await requestFolderPermission(handle)) throw new Error('尚未准許讀寫此資料夾。請再次按「繼續使用此資料夾」並選擇允許。');
      if (!ready.current) await load(true);
      else if (conflicted.current) notify('資料檔案已有其他修改。請先匯出目前修改，再確認重新讀取最新資料。');
      else persist(current.current);
    } catch (error) {
      setLocalFolder(previous => ({ ...previous, status: 'error', error: folderErrorMessage(error) }));
    } finally {
      changingDestination.current = false;
      setLocalFolder(previous => ({ ...previous, busy: false }));
    }
  }, [load, notify, persist]);

  const returnToBrowserStorage = useCallback(async () => {
    if (changingDestination.current) return;
    if (!ready.current) { setLocalFolder(previous => ({ ...previous, error: '請先連接資料夾並讀取食譜，再改回瀏覽器儲存。' })); return; }
    changingDestination.current = true;
    readGeneration.current += 1;
    setLoading(false);
    setLocalFolder(previous => ({ ...previous, busy: true, error: null }));
    try {
      await queue.current;
      const stored = await loadStoredData();
      const revision = await saveStoredData(current.current, stored.revision);
      await forgetFolder();
      saveGeneration.current += 1;
      remembered.current = null;
      applyLoaded(current.current, { kind: 'browser', revision });
      setLocalFolder(defaultFolderState());
      notify('已改回瀏覽器儲存，資料夾內原有檔案已保留');
    } catch (error) { setLocalFolder(previous => ({ ...previous, error: storageErrorMessage(error) })); }
    finally {
      changingDestination.current = false;
      setLocalFolder(previous => ({ ...previous, busy: false }));
    }
  }, [applyLoaded, notify]);

  const retrySave = useCallback(() => {
    if (changingDestination.current) return;
    if (conflicted.current) notify('請先匯出目前修改，再按「重新讀取最新資料」，避免覆蓋其他修改。');
    else if (!ready.current) void load();
    else persist(current.current);
  }, [load, persist, notify]);
  const reloadLatest = useCallback(() => { if (!changingDestination.current) void load(); }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || unsaved.current || changingDestination.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [load]);

  const value = useMemo(() => ({ data, loading, saveError, storageReady, saving, conflict, localFolder, pendingFolder, chooseLocalFolder, confirmLocalFolder, cancelLocalFolder, reconnectLocalFolder, returnToBrowserStorage, update, replaceData, notify, toast, retrySave, reloadLatest }), [data, loading, saveError, storageReady, saving, conflict, localFolder, pendingFolder, chooseLocalFolder, confirmLocalFolder, cancelLocalFolder, reconnectLocalFolder, returnToBrowserStorage, update, replaceData, notify, toast, retrySave, reloadLatest]);
  return <CookbookContext.Provider value={value}>{children}</CookbookContext.Provider>;
}

export function useCookbook(): CookbookContextValue {
  const value = useContext(CookbookContext);
  if (!value) throw new Error('useCookbook 必須在 CookbookProvider 中使用。');
  return value;
}
