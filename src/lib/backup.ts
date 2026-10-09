import { z } from 'zod';
import type { AppData } from '../types';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), '不支援的識別碼');
const text = (limit: number) => z.string().max(limit);
const amount = z.number().finite().min(0).max(1_000_000).nullable();
const servings = z.number().finite().min(0.25).max(1000);
const dateTime = z.iso.datetime({ offset: true });

export function isSafeWebUrl(value: string): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function isSafeImage(value: string): boolean {
  if (value === '') return true;
  if (value.length > 5 * 1024 * 1024) return false;
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  if (/^\/images\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(value)) return true;
  return isSafeWebUrl(value);
}

const image = z.string().refine(isSafeImage, '圖片格式或網址不安全');
const categorySchema = z.object({ id, name: text(100).min(1), emoji: text(20) }).strict();
const ingredientSchema = z.object({ id, name: text(200).min(1), amount, unit: text(50), optional: z.boolean(), seasoning: z.boolean() }).strict();
const stepSchema = z.object({ id, instruction: text(20_000).min(1), image: image.optional(), timerSeconds: z.number().int().min(0).max(86_400).optional() }).strict();
const recipeSchema = z.object({
  id, title: text(200).min(1), description: text(10_000), image, categoryId: id, tags: z.array(text(100).min(1)).max(50),
  prepMinutes: z.number().int().min(0).max(10_080), cookMinutes: z.number().int().min(0).max(10_080), servings,
  difficulty: z.enum(['簡單', '適中', '挑戰']), tool: text(300), sourceName: text(500),
  sourceUrl: text(4096).refine(value => value === '' || isSafeWebUrl(value), '來源網址只支援 http 或 https'),
  notes: text(20_000), rating: z.number().int().min(0).max(5), ingredients: z.array(ingredientSchema).min(1).max(300),
  steps: z.array(stepSchema).min(1).max(300), favorite: z.boolean(), createdAt: dateTime, updatedAt: dateTime, demo: z.boolean().optional(),
}).strict();
const shoppingSchema = z.object({ id, name: text(200).min(1), amount, unit: text(50), checked: z.boolean(), recipeIds: z.array(id).max(3000) }).strict();
const mealSchema = z.object({
  id, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '日期不正確'),
  slot: z.enum(['breakfast', 'lunch', 'dinner']), recipeId: id, servings,
}).strict();
const cookingSchema = z.object({
  stepIndex: z.number().int().min(0).max(299), checkedIngredients: z.array(id).max(300), completedSteps: z.array(id).max(300), servings,
  timerEndsAt: z.number().finite().min(0).max(253_402_300_799_999).nullable(), timerRemaining: z.number().finite().min(0).max(86_400),
}).strict();

function hasDuplicates(values: string[]): boolean { return new Set(values).size !== values.length; }

export const appDataSchema = z.object({
  version: z.literal(1), recipes: z.array(recipeSchema).max(3000), categories: z.array(categorySchema).max(200),
  shopping: z.array(shoppingSchema).max(10_000), meals: z.array(mealSchema).max(10_000),
  cooking: z.record(id, cookingSchema), theme: z.enum(['light', 'dark', 'system']),
}).strict().superRefine((data, context) => {
  const report = (message: string) => context.addIssue({ code: 'custom', message });
  for (const [name, rows] of [['食譜', data.recipes], ['分類', data.categories], ['購物項目', data.shopping], ['煮食計劃', data.meals]] as const) {
    if (hasDuplicates(rows.map(row => row.id))) report(`${name}識別碼重複`);
  }
  const categories = new Set(data.categories.map(category => category.id));
  const recipes = new Map(data.recipes.map(recipe => [recipe.id, recipe]));
  for (const recipe of data.recipes) {
    if (!categories.has(recipe.categoryId)) report(`「${recipe.title}」的分類不存在`);
    if (hasDuplicates(recipe.ingredients.map(ingredient => ingredient.id))) report(`「${recipe.title}」的食材識別碼重複`);
    if (hasDuplicates(recipe.steps.map(step => step.id))) report(`「${recipe.title}」的步驟識別碼重複`);
  }
  for (const item of data.shopping) {
    if (item.recipeIds.some(recipeId => !recipes.has(recipeId))) report('購物清單包含不存在的食譜');
    if (hasDuplicates(item.recipeIds)) report('購物清單的來源食譜重複');
  }
  for (const meal of data.meals) if (!recipes.has(meal.recipeId)) report('煮食計劃包含不存在的食譜');
  for (const [recipeId, progress] of Object.entries(data.cooking)) {
    const recipe = recipes.get(recipeId);
    if (!recipe) { report('烹調進度包含不存在的食譜'); continue; }
    if (progress.stepIndex >= recipe.steps.length) report('烹調進度的步驟超出範圍');
    const ingredientIds = new Set(recipe.ingredients.map(ingredient => ingredient.id));
    const stepIds = new Set(recipe.steps.map(step => step.id));
    if (progress.checkedIngredients.some(ingredientId => !ingredientIds.has(ingredientId))) report('烹調進度包含不存在的食材');
    if (progress.completedSteps.some(stepId => !stepIds.has(stepId))) report('烹調進度包含不存在的步驟');
    if (hasDuplicates(progress.checkedIngredients) || hasDuplicates(progress.completedSteps)) report('烹調進度包含重複項目');
  }
});

export function validateAppData(value: unknown): AppData {
  const result = appDataSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`備份格式不正確：${first.path.length ? `${first.path.join('.')} — ` : ''}${first.message}`);
  }
  return result.data;
}

export function parseBackup(textContent: string): AppData {
  if (textContent.length > MAX_BACKUP_BYTES || new TextEncoder().encode(textContent).byteLength > MAX_BACKUP_BYTES) throw new Error('備份太大，請選擇 50 MB 或以下的 JSON 檔案。');
  let value: unknown;
  try { value = JSON.parse(textContent); }
  catch { throw new Error('無法讀取 JSON，請選擇從食譜庫匯出的完整備份檔案。'); }
  return validateAppData(value);
}

export function exportBackup(data: AppData): void {
  const validated = validateAppData(data);
  const content = JSON.stringify(validated, null, 2);
  if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) throw new Error('備份超過 50 MB，請先減少食譜圖片大小。');
  const file = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `我的食譜庫-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
