import { describe, expect, it } from 'vitest';
import { createInitialData } from '../data/seeds';
import { addRecipeToShopping, formatAmount, scaledAmount } from './recipes';

describe('食材份量', () => {
  it('用原始份量計算不同人數而不改動食譜', () => {
    expect(scaledAmount(350, 3, 2)).toBe(525);
    expect(scaledAmount(0.5, 1, 2)).toBe(0.25);
    expect(scaledAmount(350, 2, 2)).toBe(350);
    expect(scaledAmount(null, 4, 2)).toBeNull();
    expect(scaledAmount(100, 2, 0)).toBe(100);
    expect(formatAmount(0.333333)).toBe('0.33');
    expect(formatAmount(null)).toBe('適量');
  });

  it('合併同名同單位食材並保留不同單位及適量項目', () => {
    const data = createInitialData();
    const first = data.recipes[0];
    const second = data.recipes[1];
    addRecipeToShopping(data, first, 4);
    addRecipeToShopping(data, second, 2);
    const garlic = data.shopping.find(item => item.name === '蒜頭' && item.unit === '瓣');
    expect(garlic?.amount).toBe(6);
    expect(garlic?.recipeIds).toEqual([first.id, second.id]);
    expect(data.shopping.filter(item => item.name === '生抽')).toHaveLength(1);
    expect(data.shopping.find(item => item.name === '生抽')?.amount).toBe(3);
    expect(first.ingredients.find(item => item.name === '蒜頭')?.amount).toBe(2);
    const noMeasure = structuredClone(first);
    noMeasure.ingredients = [{ id: 'test-ingredient', name: ' 蒜頭 ', unit: ' 瓣 ', amount: null, optional: false, seasoning: false }];
    addRecipeToShopping(data, noMeasure, 2);
    expect(data.shopping.filter(item => item.name === '蒜頭')).toHaveLength(2);
    expect(data.shopping.find(item => item.name === '蒜頭' && item.amount === null)).toBeDefined();
  });

  it('再次加入已購買食材會增加份量及取消勾選而不重複來源', () => {
    const data = createInitialData();
    addRecipeToShopping(data, data.recipes[0], 2);
    data.shopping.forEach(item => { item.checked = true; });
    addRecipeToShopping(data, data.recipes[0], 2);
    expect(data.shopping[0].amount).toBe(4);
    expect(data.shopping[0].checked).toBe(false);
    expect(data.shopping[0].recipeIds).toEqual([data.recipes[0].id]);
  });
});
