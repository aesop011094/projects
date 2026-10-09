import { describe, expect, it } from 'vitest';
import { parseIngredient, parseRecipeText } from './ImportRecipe';

describe('本機食譜文字匯入', () => {
  it('保留明確份量、調味料分類、步驟溫度及時間', () => {
    const recipe = parseRecipeText('薑蔥雞腿肉\n準備時間：10 分鐘\n烹調時間：15 分鐘\n份量：2 人份\n食材\n雞腿肉 350 g\n蔥 3 條\n調味料\n生抽 1/2 湯匙\n做法\n1. 雞肉醃 10 分鐘。\n2. 煮至最厚位置達 75°C。', 'category-chinese');
    expect(recipe.title).toBe('薑蔥雞腿肉');
    expect(recipe.prepMinutes).toBe(10);
    expect(recipe.cookMinutes).toBe(15);
    expect(recipe.servings).toBe(2);
    expect(recipe.ingredients.map(item => [item.name, item.amount, item.unit, item.seasoning])).toEqual([['雞腿肉', 350, 'g', false], ['蔥', 3, '條', false], ['生抽', 0.5, '湯匙', true]]);
    expect(recipe.steps.map(step => step.instruction)).toEqual(['雞肉醃 10 分鐘。', '煮至最厚位置達 75°C。']);
    expect(recipe.notes).toContain('原始食譜文字');
  });

  it('份量範圍及混合分數需由人確認，不取其中一個數字', () => {
    for (const name of ['雞肉 400–500 g', '鹽 1 1/2 茶匙', '糖 ½ 茶匙']) {
      const ingredient = parseIngredient(name);
      expect(ingredient.amount).toBeNull();
      expect(ingredient.name).toBe(name);
    }
  });

  it('未列明時間及份量時清楚註明預設值', () => {
    const recipe = parseRecipeText('我的湯\n食材\n鹽 少許\n做法\n加熱後試味。', 'category-other');
    expect(recipe.ingredients[0].amount).toBeNull();
    expect(recipe.prepMinutes + recipe.cookMinutes).toBe(0);
    expect(recipe.notes).toContain('暫填 0 分鐘');
    expect(recipe.notes).toContain('暫填 1 人份');
    expect(recipe.steps[0].instruction).toBe('加熱後試味。');
  });

  it('缺少食材或步驟時提供可修正的格式提示', () => {
    expect(() => parseRecipeText('我的食譜\n雞肉 400 g\n煎熟雞肉。', 'category-other')).toThrow('食材');
  });
});
