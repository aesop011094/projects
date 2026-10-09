import { describe, expect, it } from 'vitest';
import { createInitialData } from '../data/seeds';
import { isSafeImage, isSafeWebUrl, parseBackup } from './backup';

describe('示範內容及備份', () => {
  it('六款完整繁體中文食譜及十二個分類可往返 JSON 備份', () => {
    const data = createInitialData();
    const restored = parseBackup(JSON.stringify(data));
    expect(restored).toEqual(data);
    expect(restored.categories).toHaveLength(12);
    expect(restored.recipes).toHaveLength(6);
    for (const recipe of restored.recipes) {
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(7);
      expect(recipe.steps).toHaveLength(5);
      expect(recipe.description.length).toBeGreaterThan(20);
      expect(recipe.sourceName).toContain('示範');
      expect(recipe.image).toMatch(/^\/images\//);
    }
  });

  it('壞 JSON、未知版本及錯誤型別會拒絕匯入', () => {
    expect(() => parseBackup('{')).toThrow('無法讀取 JSON');
    const data = createInitialData();
    expect(() => parseBackup(JSON.stringify({ ...data, version: 2 }))).toThrow('備份格式不正確');
    const malformed = structuredClone(data);
    (malformed.recipes[0] as unknown as Record<string, unknown>).servings = '2';
    expect(() => parseBackup(JSON.stringify(malformed))).toThrow('servings');
  });

  it('拒絕遺失分類、重複識別碼及不存在的食譜引用', () => {
    const data = createInitialData();
    data.categories = [];
    expect(() => parseBackup(JSON.stringify(data))).toThrow('分類不存在');
    const duplicate = createInitialData();
    duplicate.recipes.push(structuredClone(duplicate.recipes[0]));
    expect(() => parseBackup(JSON.stringify(duplicate))).toThrow('識別碼重複');
    const invalidMeal = createInitialData();
    invalidMeal.meals.push({ id: 'meal-test', date: '2026-10-09', recipeId: 'missing-recipe', slot: 'dinner', servings: 2 });
    expect(() => parseBackup(JSON.stringify(invalidMeal))).toThrow('不存在的食譜');
  });

  it('驗證烹調進度的步驟和食材引用及真實日期', () => {
    const data = createInitialData();
    data.cooking[data.recipes[0].id] = { stepIndex: 0, servings: 2, checkedIngredients: ['unknown'], completedSteps: [], timerEndsAt: null, timerRemaining: 0 };
    expect(() => parseBackup(JSON.stringify(data))).toThrow('不存在的食材');
    data.cooking = {};
    data.meals.push({ id: 'meal-test', date: '2026-02-30', recipeId: data.recipes[0].id, slot: 'dinner', servings: 2 });
    expect(() => parseBackup(JSON.stringify(data))).toThrow('日期不正確');
  });

  it('阻止執行型網址、SVG、檔案網址及憑證網址', () => {
    for (const unsafe of ['javascript:alert(1)', 'file:///private/a.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', '//example.org/a.jpg', '/images/../secret.jpg', 'https://user:password@example.com/a.jpg']) {
      expect(isSafeImage(unsafe)).toBe(false);
    }
    expect(isSafeImage('/images/chicken-noodles.jpg')).toBe(true);
    expect(isSafeImage('data:image/jpeg;base64,YWJjZA==')).toBe(true);
    expect(isSafeWebUrl('https://example.com/recipe')).toBe(true);
    expect(isSafeWebUrl('javascript:alert(1)')).toBe(false);
    const data = createInitialData();
    data.recipes[0].sourceUrl = 'javascript:alert(1)';
    expect(() => parseBackup(JSON.stringify(data))).toThrow('來源網址');
  });

  it('每次初始化都會提供獨立副本', () => {
    const first = createInitialData();
    first.recipes[0].title = '更改';
    first.categories[0].name = '更改';
    first.recipes[0].ingredients[0].amount = 99;
    first.recipes[0].tags.push('不應保留');
    const second = createInitialData();
    expect(second.recipes[0].title).toBe('港式黑椒雞腿扒');
    expect(second.categories[0].name).toBe('港式料理');
    expect(second.recipes[0].ingredients[0].amount).toBe(2);
    expect(second.recipes[0].tags).not.toContain('不應保留');
  });
});
