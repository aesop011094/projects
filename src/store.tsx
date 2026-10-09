import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData } from './types';
import { createEmptyData } from './data/seeds';
import { validateAppData } from './lib/backup';
import { loadStoredData, saveStoredData, storageErrorMessage, StorageConflictError } from './lib/storage';

export interface CookbookContextValue {
  data: AppData;
  loading: boolean;
  saveError: string | null;
  storageReady: boolean;
  saving: boolean;
  conflict: boolean;
  update: (mutator: (draft: AppData) => void) => void;
  replaceData: (data: AppData) => void;
  notify: (message: string) => void;
  toast: string | null;
  retrySave: () => void;
  reloadLatest: () => void;
}

const CookbookContext = createContext<CookbookContextValue | null>(null);

export function CookbookProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(createEmptyData);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const current = useRef(data);
  const ready = useRef(false);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const saveGeneration = useRef(0);
  const revision = useRef(0);
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

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    // Cancel queued snapshots; an already-running transaction must finish before reading.
    saveGeneration.current += 1;
    ready.current = false;
    setStorageReady(false);
    setLoading(true);
    setSaveError(null);
    try {
      await queue.current;
      if (!mounted.current || generation !== readGeneration.current) return;
      const stored = await loadStoredData();
      if (!mounted.current || generation !== readGeneration.current) return;
      current.current = stored.data;
      setData(stored.data);
      revision.current = stored.revision;
      conflicted.current = false;
      setConflict(false);
      ready.current = true;
      setStorageReady(true);
      unsaved.current = false;
    } catch (error) {
      if (!mounted.current || generation !== readGeneration.current) return;
      // Read failures never seed a replacement or allow a write over the unread record.
      setSaveError(`未能讀取已有資料，已保留原本的資料庫。${storageErrorMessage(error)}`);
    } finally {
      if (mounted.current && generation === readGeneration.current) setLoading(false);
    }
  }, []);

  const persist = useCallback((next: AppData) => {
    const snapshot = structuredClone(next);
    const generation = saveGeneration.current;
    pending.current += 1;
    unsaved.current = true;
    setSaving(true);
    // Serial writes stop an older, slower save from overwriting a more recent change.
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        if (generation !== saveGeneration.current || conflicted.current) return;
        revision.current = await saveStoredData(snapshot, revision.current);
        if (mounted.current) setSaveError(null);
        if (pending.current === 1) unsaved.current = false;
      } catch (error) {
        unsaved.current = true;
        if (error instanceof StorageConflictError) {
          conflicted.current = true;
          if (mounted.current) setConflict(true);
        }
        if (mounted.current) setSaveError(`尚未儲存目前修改。${storageErrorMessage(error)}`);
      } finally {
        pending.current -= 1;
        if (mounted.current && pending.current === 0) setSaving(false);
      }
    });
  }, []);

  const replaceData = useCallback((next: AppData) => {
    if (conflicted.current) { notify('另一個分頁已更新資料。請先匯出目前修改，再重新讀取最新資料。'); return; }
    if (!ready.current) { notify('資料庫尚未準備好，請先重試讀取資料。'); return; }
    try {
      const validated = validateAppData(next);
      current.current = validated;
      setData(validated);
      persist(validated);
    } catch (error) {
      const message = storageErrorMessage(error);
      notify(message);
      setSaveError(`未能更新資料：${message}`);
    }
  }, [notify, persist]);

  const update = useCallback((mutator: (draft: AppData) => void) => {
    if (conflicted.current) { notify('另一個分頁已更新資料。請先匯出目前修改，再重新讀取最新資料。'); return; }
    if (!ready.current) { notify('資料庫尚未準備好，請先重試讀取資料。'); return; }
    try {
      const draft = structuredClone(current.current);
      mutator(draft);
      replaceData(draft);
    } catch (error) { notify(storageErrorMessage(error)); }
  }, [notify, replaceData]);

  const retrySave = useCallback(() => {
    if (conflicted.current) notify('為保護另一個分頁的最新資料，請先匯出目前修改，再按「重新讀取最新資料」。');
    else if (!ready.current) void load();
    else persist(current.current);
  }, [load, persist, notify]);

  const reloadLatest = useCallback(() => { void load(); }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || unsaved.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [load]);

  const value = useMemo(() => ({ data, loading, saveError, storageReady, saving, conflict, update, replaceData, notify, toast, retrySave, reloadLatest }), [data, loading, saveError, storageReady, saving, conflict, update, replaceData, notify, toast, retrySave, reloadLatest]);
  return <CookbookContext.Provider value={value}>{children}</CookbookContext.Provider>;
}

export function useCookbook(): CookbookContextValue {
  const value = useContext(CookbookContext);
  if (!value) throw new Error('useCookbook 必須在 CookbookProvider 中使用。');
  return value;
}
