import type { AppData, Recipe } from '../types';

/** Round only when displayed: repeated servings changes never modify the original amount. */
export function formatAmount(amount: number | null): string {
  if (amount === null) return '適量';
  return new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 2 }).format(amount);
}

export function scaledAmount(amount: number | null, servings: number, original: number): number | null {
  if (amount === null) return null;
  if (!Number.isFinite(servings) || !Number.isFinite(original) || servings <= 0 || original <= 0) return amount;
  return Math.round((amount * servings / original) * 10000) / 10000;
}

export function addRecipeToShopping(draft: AppData, recipe: Recipe, servings: number): void {
  for (const ingredient of recipe.ingredients) {
    const name = ingredient.name.trim();
    const unit = ingredient.unit.trim();
    const amount = scaledAmount(ingredient.amount, servings, recipe.servings);
    // A measured amount and "適量" stay separate: their quantities cannot be added reliably.
    const existing = draft.shopping.find(item => item.name.trim() === name && item.unit.trim() === unit && (item.amount === null) === (amount === null));
    if (existing) {
      if (existing.amount !== null && amount !== null) existing.amount = Math.round((existing.amount + amount) * 10000) / 10000;
      existing.checked = false;
      if (!existing.recipeIds.includes(recipe.id)) existing.recipeIds.push(recipe.id);
    } else {
      draft.shopping.push({ id: crypto.randomUUID(), name, amount, unit, checked: false, recipeIds: [recipe.id] });
    }
  }
}
