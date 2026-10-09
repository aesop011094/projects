import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChefHat, Clock3, Copy, Heart, Minus, Pencil, Plus, ShoppingBasket, Star, Trash2, Users, ExternalLink } from 'lucide-react';
import { useCookbook } from '../store';
import type { AppData, CookingProgress, Recipe } from '../types';
import { addRecipeToShopping, formatAmount, scaledAmount } from '../lib/recipes';
import { ConfirmDialog, Modal } from './ui';
import '../recipe.css';

export function createProgress(recipe: Recipe): CookingProgress {
  return { stepIndex: 0, checkedIngredients: [], completedSteps: [], servings: recipe.servings, timerEndsAt: null, timerRemaining: recipe.steps[0]?.timerSeconds ?? 0 };
}
export function updateProgress(draft: AppData, recipe: Recipe, mutate: (progress: CookingProgress) => void) {
  const progress = draft.cooking[recipe.id] ?? (draft.cooking[recipe.id] = createProgress(recipe));
  mutate(progress);
}
export function setCookingStep(progress: CookingProgress, recipe: Recipe, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= recipe.steps.length) return;
  progress.stepIndex = index;
  // Keep an active countdown running when browsing another step. A paused timer
  // follows the selected step so entering Cooking Mode shows the correct preset.
  if (progress.timerEndsAt === null) progress.timerRemaining = recipe.steps[index].timerSeconds ?? 0;
}
function safeUrl(url: string) { try { const value = new URL(url); return ['http:', 'https:'].includes(value.protocol) ? value.href : undefined; } catch { return undefined; } }

export default function RecipeDetail({ recipeId, onClose, onEdit, onCook }: { recipeId: string; onClose: () => void; onEdit: (recipe: Recipe) => void; onCook: (recipe: Recipe) => void }) {
  const { data, update, notify } = useCookbook();
  const recipe = data.recipes.find(item => item.id === recipeId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState(recipe?.notes ?? '');
  if (!recipe) return <Modal title="找不到食譜" onClose={onClose}><p>這款食譜已被刪除。</p></Modal>;
  const progress = data.cooking[recipe.id] ?? createProgress(recipe);
  const category = data.categories.find(item => item.id === recipe.categoryId);
  const currentIndex = Math.min(progress.stepIndex, Math.max(0, recipe.steps.length - 1));
  const servings = progress.servings;
  const changeProgress = (mutate: (value: CookingProgress) => void) => update(draft => updateProgress(draft, recipe, mutate));
  const toggleIngredient = (id: string) => changeProgress(value => { value.checkedIngredients = value.checkedIngredients.includes(id) ? value.checkedIngredients.filter(item => item !== id) : [...value.checkedIngredients, id]; });
  const toggleStep = (id: string) => changeProgress(value => { value.completedSteps = value.completedSteps.includes(id) ? value.completedSteps.filter(item => item !== id) : [...value.completedSteps, id]; });
  const duplicate = () => {
    const now = new Date().toISOString();
    const copy: Recipe = { ...recipe, id: crypto.randomUUID(), title: `${recipe.title.slice(0, 196)}（副本）`, favorite: false, createdAt: now, updatedAt: now, demo: false, ingredients: recipe.ingredients.map(item => ({ ...item, id: crypto.randomUUID() })), steps: recipe.steps.map(item => ({ ...item, id: crypto.randomUUID() })) };
    update(draft => { draft.recipes.unshift(copy); });
    notify('已複製食譜，你可以修改副本');
    onEdit(copy);
  };
  const remove = () => {
    update(draft => { draft.recipes = draft.recipes.filter(item => item.id !== recipe.id); draft.meals = draft.meals.filter(item => item.recipeId !== recipe.id); delete draft.cooking[recipe.id]; draft.shopping.forEach(item => { item.recipeIds = item.recipeIds.filter(id => id !== recipe.id); }); });
    notify('已刪除食譜');
    onClose();
  };
  const ingredientSection = (seasoning: boolean) => {
    const ingredients = recipe.ingredients.filter(item => item.seasoning === seasoning);
    if (!ingredients.length) return null;
    return <div className="ingredient-group"><h4>{seasoning ? '調味料' : '食材'}</h4>{ingredients.map(ingredient => <label className={`ingredient-row ${progress.checkedIngredients.includes(ingredient.id) ? 'is-checked' : ''}`} key={ingredient.id}>
      <input type="checkbox" checked={progress.checkedIngredients.includes(ingredient.id)} onChange={() => toggleIngredient(ingredient.id)} />
      <span className="ingredient-name">{ingredient.name}{ingredient.optional && <small>可選</small>}</span>
      <span className="ingredient-amount"><strong>{formatAmount(scaledAmount(ingredient.amount, servings, recipe.servings))}{ingredient.amount !== null && ` ${ingredient.unit}`}</strong>{servings !== recipe.servings && <small>原份量：{formatAmount(ingredient.amount)}{ingredient.amount !== null && ` ${ingredient.unit}`}</small>}</span>
    </label>)}</div>;
  };
  const sourceUrl = safeUrl(recipe.sourceUrl);
  return <>
    <Modal title="食譜詳情" onClose={onClose} className="recipe-detail-modal">
      <div className="recipe-cover">{recipe.image ? <img src={recipe.image} alt={recipe.title} /> : <div className="recipe-image-placeholder"><ChefHat size={54}/><span>我的私人食譜</span></div>}<button className={`recipe-cover-heart ${recipe.favorite ? 'active' : ''}`} aria-label={recipe.favorite ? '取消收藏' : '加入收藏'} onClick={() => update(draft => { const found = draft.recipes.find(item => item.id === recipe.id); if (found) found.favorite = !found.favorite; })}><Heart size={23} fill={recipe.favorite ? 'currentColor' : 'none'}/></button></div>
      <div className="recipe-detail-content">
        <div className="recipe-labels">{category && <span className="recipe-tag">{category.emoji} {category.name}</span>}{recipe.tags.map(tag => <span className="recipe-tag subtle" key={tag}>{tag}</span>)}{recipe.demo && <span className="demo-badge">示範食譜</span>}</div>
        <h2 className="recipe-detail-title">{recipe.title}</h2><p className="recipe-description">{recipe.description}</p>
        <div className="recipe-metrics"><span><Clock3 size={19}/><strong>{recipe.prepMinutes + recipe.cookMinutes} 分鐘</strong><small>準備 {recipe.prepMinutes} · 烹調 {recipe.cookMinutes}</small></span><span><Users size={19}/><strong>{recipe.servings} 人份</strong><small>原食譜份量</small></span><span><ChefHat size={19}/><strong>{recipe.difficulty}</strong><small>{recipe.tool || '家用煮食工具'}</small></span></div>
        <div className="recipe-action-bar"><button className="button primary" onClick={() => onCook(recipe)}><ChefHat size={18}/>開始煮食</button><button className="button secondary" onClick={() => onEdit(recipe)}><Pencil size={17}/>編輯</button><button className="button secondary" onClick={duplicate}><Copy size={17}/>複製</button><button className="button recipe-delete" onClick={() => setConfirmDelete(true)} aria-label="刪除食譜"><Trash2 size={18}/></button></div>
        <section className="recipe-section"><div className="recipe-section-heading"><div><span className="section-eyebrow">為一餐美味，好好準備</span><h3>準備好你的食材</h3></div><div className="servings-control"><button className="icon-button" aria-label="減少一人份" disabled={servings <= 1} onClick={() => changeProgress(value => { value.servings = Math.max(1, value.servings - 1); })}><Minus size={16}/></button><span>{servings} 人份</span><button className="icon-button" aria-label="增加一人份" disabled={servings >= 100} onClick={() => changeProgress(value => { value.servings = Math.min(100, value.servings + 1); })}><Plus size={16}/></button></div></div><p className="recipe-helper">勾選已準備的食材。原食譜為 {recipe.servings} 人份，份量會隨人數調整。</p>{ingredientSection(false)}{ingredientSection(true)}<button className="button secondary shopping-add" onClick={() => { update(draft => addRecipeToShopping(draft, recipe, servings)); notify(`已加入 ${servings} 人份的食材至購物清單`); }}><ShoppingBasket size={18}/>加入購物清單</button></section>
        <section className="recipe-section"><div className="recipe-section-heading"><div><span className="section-eyebrow">每一步，都加一點心思</span><h3>一步一步，慢慢煮</h3></div><span className="progress-pill">{progress.completedSteps.length} / {recipe.steps.length} 已完成</span></div><div className="recipe-step-list">{recipe.steps.map((step, index) => <article key={step.id} className={`recipe-step ${index === currentIndex ? 'current' : ''} ${progress.completedSteps.includes(step.id) ? 'completed' : ''}`}><button className="step-number" aria-label={`查看第 ${index + 1} 步`} aria-current={index === currentIndex ? 'step' : undefined} onClick={() => changeProgress(value => setCookingStep(value, recipe, index))}>{index + 1}</button><div className="step-body"><h4>第 {index + 1} 步{step.timerSeconds ? <span><Clock3 size={13}/>{formatAmount(step.timerSeconds / 60)} 分鐘</span> : null}</h4><p>{step.instruction}</p>{step.image && <img className="step-image" src={step.image} alt={`${recipe.title}第 ${index + 1} 步示範`} />}<label className="step-complete"><input type="checkbox" checked={progress.completedSteps.includes(step.id)} onChange={() => toggleStep(step.id)}/><span>已完成這一步</span></label></div></article>)}</div><div className="step-pagination"><button className="button secondary" disabled={currentIndex === 0} onClick={() => changeProgress(value => setCookingStep(value, recipe, currentIndex - 1))}><ArrowLeft size={16}/>上一步</button><span>第 {currentIndex + 1} / {recipe.steps.length} 步</span><button className="button secondary" disabled={currentIndex === recipe.steps.length - 1} onClick={() => changeProgress(value => setCookingStep(value, recipe, currentIndex + 1))}>下一步<ArrowRight size={16}/></button></div></section>
        <section className="recipe-section recipe-notes"><div className="recipe-section-heading"><div><span className="section-eyebrow">記低屬於你的味道</span><h3>我的煮食筆記</h3></div></div><div className="recipe-rating"><span>這次煮得如何？</span><div>{[1, 2, 3, 4, 5].map(value => <button key={value} className={`rating-star ${recipe.rating >= value ? 'active' : ''}`} aria-label={`評分 ${value} 星`} aria-pressed={recipe.rating === value} onClick={() => update(draft => { const found = draft.recipes.find(item => item.id === recipe.id); if (found) { found.rating = found.rating === value ? 0 : value; found.updatedAt = new Date().toISOString(); } })}><Star size={23} fill={recipe.rating >= value ? 'currentColor' : 'none'}/></button>)}</div></div><label className="sr-only" htmlFor="recipe-notes">個人備註</label><textarea id="recipe-notes" className="field-input" rows={4} value={notes} maxLength={10000} onChange={event => setNotes(event.target.value)} placeholder="記低你的心得，例如：下次少落一點鹽、雞腿多煮 3 分鐘……"/><button className="button secondary" disabled={notes === recipe.notes} onClick={() => { update(draft => { const found = draft.recipes.find(item => item.id === recipe.id); if (found) { found.notes = notes; found.updatedAt = new Date().toISOString(); } }); notify('已儲存煮食筆記'); }}><Check size={16}/>儲存筆記</button></section>
        <div className="recipe-source"><span>{recipe.sourceName || '你的私人食譜'}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">查看原始來源<ExternalLink size={14}/></a>}{recipe.demo && <p>食材份量及步驟為示範內容，請按個人口味調整；封面圖片屬示意用途。</p>}</div>
      </div>
    </Modal>
    {confirmDelete && <ConfirmDialog title="刪除這款食譜？" description={`「${recipe.title}」及其煮食進度會被刪除，煮食計劃中的安排亦會移除。此操作無法復原。`} onConfirm={remove} onClose={() => setConfirmDelete(false)}/>}
  </>;
}
