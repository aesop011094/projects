export type Difficulty = '簡單' | '適中' | '挑戰';
export type Theme = 'light' | 'dark' | 'system';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface Category { id: string; name: string; emoji: string }
export interface Ingredient {
  id: string;
  name: string;
  amount: number | null;
  unit: string;
  optional: boolean;
  seasoning: boolean;
}
export interface CookingStep { id: string; instruction: string; image?: string; timerSeconds?: number }
export interface Recipe {
  id: string;
  title: string;
  description: string;
  image: string;
  categoryId: string;
  tags: string[];
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  difficulty: Difficulty;
  tool: string;
  sourceName: string;
  sourceUrl: string;
  notes: string;
  rating: number;
  ingredients: Ingredient[];
  steps: CookingStep[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  demo?: boolean;
}
export interface ShoppingItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string;
  checked: boolean;
  recipeIds: string[];
}
export interface MealEntry { id: string; date: string; slot: MealSlot; recipeId: string; servings: number }
export interface CookingProgress {
  stepIndex: number;
  checkedIngredients: string[];
  completedSteps: string[];
  servings: number;
  timerEndsAt: number | null;
  timerRemaining: number;
}
export interface AppData {
  version: 1;
  recipes: Recipe[];
  categories: Category[];
  shopping: ShoppingItem[];
  meals: MealEntry[];
  cooking: Record<string, CookingProgress>;
  theme: Theme;
}
export type Page = 'home' | 'recipes' | 'favorites' | 'planner' | 'shopping' | 'settings';
