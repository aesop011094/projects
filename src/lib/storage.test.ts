import { describe, expect, it } from 'vitest';
import { createInitialData } from '../data/seeds';
import { decodeStoredRecord, StorageConflictError } from './storage';

describe('本機資料庫版本記錄', () => {
  it('識別舊版 AppData 並完整保留已有食譜', () => {
    const original = createInitialData();
    original.recipes[0].title = '我的已有食譜';
    original.theme = 'dark';
    const legacy = decodeStoredRecord(original);
    expect(legacy.revision).toBe(0);
    expect(legacy.data).toEqual(original);
  });

  it('新版 envelope 保留 revision 及相同資料', () => {
    const original = createInitialData();
    const decoded = decodeStoredRecord({ revision: 7, data: original });
    expect(decoded.revision).toBe(7);
    expect(decoded.data).toEqual(original);
  });

  it('拒絕非整數、缺少欄位、額外欄位及壞資料而不冒認為舊版', () => {
    for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(() => decodeStoredRecord({ revision, data: createInitialData() })).toThrow('版本記錄不正確');
    }
    expect(() => decodeStoredRecord({ revision: 1 })).toThrow('版本記錄不正確');
    expect(() => decodeStoredRecord({ revision: 1, data: createInitialData(), extra: true })).toThrow('版本記錄不正確');
    expect(() => decodeStoredRecord({ revision: 1, data: { version: 999 } })).toThrow('備份格式不正確');
  });

  it('衝突錯誤可被分類並提供保留／備份指引', () => {
    const error = new StorageConflictError();
    expect(error).toBeInstanceOf(StorageConflictError);
    expect(error.name).toBe('StorageConflictError');
    expect(error.message).toContain('目前修改仍保留');
    expect(error.message).toContain('匯出備份');
  });
});
