import { useMemo, useState } from 'react';
import { CalendarDays, ChefHat, ChevronLeft, ChevronRight, Heart, Plus, ShoppingBasket, X } from 'lucide-react';
import { useCookbook } from '../store';
import { addRecipeToShopping } from '../lib/recipes';
import type { MealSlot } from '../types';
import { Modal } from './ui';
import '../organize.css';

const slots: { id: MealSlot; label: string; emoji: string }[] = [{ id: 'breakfast', label: '早餐', emoji: '☀️' }, { id: 'lunch', label: '午餐', emoji: '🍚' }, { id: 'dinner', label: '晚餐', emoji: '🌙' }];
const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
export function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function startOfWeek(date: Date) { const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); next.setDate(next.getDate() - (next.getDay() + 6) % 7); return next; }
function shiftedDate(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }

export default function MealPlanner({ onOpenRecipe }: { onOpenRecipe: (id: string) => void }) {
  const { data, update, notify } = useCookbook();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [adding, setAdding] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState(2);
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftedDate(weekStart, index)), [weekStart]);
  const dates = days.map(localDate);
  const weekMeals = data.meals.filter(meal => dates.includes(meal.date) && data.recipes.some(recipe => recipe.id === meal.recipeId));
  const favorites = data.recipes.filter(recipe => recipe.favorite && recipe.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const today = localDate(new Date());
  const openAdd = (date: string, slot: MealSlot) => { setAdding({ date, slot }); setRecipeId(''); setQuery(''); setServings(2); };
  const addMeal = () => {
    if (!adding || !data.recipes.some(recipe => recipe.id === recipeId) || !Number.isInteger(servings) || servings < 1 || servings > 100) return;
    update(draft => { draft.meals.push({ id: crypto.randomUUID(), date: adding.date, slot: adding.slot, recipeId, servings }); });
    setAdding(null);
    notify('食譜已加入煮食計劃');
  };
  const createShopping = (replace: boolean) => {
    update(draft => {
      if (replace) draft.shopping = [];
      weekMeals.forEach(meal => { const recipe = draft.recipes.find(item => item.id === meal.recipeId); if (recipe) addRecipeToShopping(draft, recipe, meal.servings); });
    });
    setGenerating(false);
    notify(replace ? '已按本週計劃重新建立購物清單' : '已將本週食材累加到購物清單');
  };

  return <div className="organize-page planner-page">
    <div className="organize-heading"><div><p className="organize-eyebrow">留一點時間，好好吃飯</p><h1>每週煮食計劃</h1><p className="muted">把最愛的食譜排進一週，讓每一餐更有期待。</p></div><button className="button primary" onClick={() => setGenerating(true)} disabled={!weekMeals.length}><ShoppingBasket size={18}/>產生購物清單</button></div>
    <div className="planner-toolbar"><div className="planner-week"><CalendarDays size={22}/><strong>{days[0].getFullYear()} 年 {days[0].getMonth() + 1} 月 {days[0].getDate()} 日 — {days[6].getMonth() + 1} 月 {days[6].getDate()} 日</strong><span>{weekMeals.length} 款已安排</span></div><div className="planner-controls"><button className="icon-button" aria-label="上一週" onClick={() => setWeekStart(shiftedDate(weekStart, -7))}><ChevronLeft size={20}/></button><button className="button secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>本週</button><button className="icon-button" aria-label="下一週" onClick={() => setWeekStart(shiftedDate(weekStart, 7))}><ChevronRight size={20}/></button></div></div>
    <div className="planner-grid">{days.map((date, index) => <section key={localDate(date)} className={`planner-day ${localDate(date) === today ? 'is-today' : ''}`}><div className="planner-day-heading"><span>{weekdays[index]}</span><strong>{date.getMonth() + 1}/{date.getDate()}</strong>{localDate(date) === today && <small>今天</small>}</div>{slots.map(slot => <div className="planner-slot" key={slot.id}><div className="planner-slot-label"><span>{slot.emoji}</span>{slot.label}</div>{weekMeals.filter(meal => meal.date === localDate(date) && meal.slot === slot.id).map(meal => { const recipe = data.recipes.find(item => item.id === meal.recipeId)!; return <div key={meal.id} className="planner-recipe"><button className="planner-recipe-open" onClick={() => onOpenRecipe(recipe.id)}>{recipe.image ? <img src={recipe.image} alt="" loading="lazy"/> : <div className="planner-image-placeholder" aria-hidden="true"><ChefHat size={25}/></div>}<strong>{recipe.title}</strong><span>{meal.servings} 人份</span></button><button className="planner-remove" aria-label={`從${weekdays[index]}${slot.label}移除${recipe.title}`} onClick={() => update(draft => { draft.meals = draft.meals.filter(item => item.id !== meal.id); })}><X size={13}/></button></div>; })}<button className="planner-add" aria-label={`新增${weekdays[index]}${slot.label}食譜`} onClick={() => openAdd(localDate(date), slot.id)}><Plus size={15}/><span>加入食譜</span></button></div>)}</section>)}</div>
    <p className="organize-footnote">計劃按實際日期儲存；切換週數不會改動已安排的餐點。每餐可加入多款食譜。</p>
    {adding && <Modal title={`${adding.date} · ${slots.find(slot => slot.id === adding.slot)?.label}`} onClose={() => setAdding(null)} className="planner-pick-modal"><p className="muted">從你的最愛挑選今天想煮的食譜。</p><input className="field" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋我的最愛…" aria-label="搜尋最愛食譜"/><div className="planner-favorites">{favorites.length ? favorites.map(recipe => <button key={recipe.id} className={`planner-favorite ${recipeId === recipe.id ? 'selected' : ''}`} aria-pressed={recipeId === recipe.id} onClick={() => { setRecipeId(recipe.id); setServings(recipe.servings); }}>{recipe.image ? <img src={recipe.image} alt=""/> : <div className="planner-image-placeholder" aria-hidden="true"><ChefHat size={25}/></div>}<div><strong>{recipe.title}</strong><span>{recipe.prepMinutes + recipe.cookMinutes} 分鐘 · {recipe.servings} 人份</span></div><Heart size={17}/></button>) : <div className="organize-small-empty"><Heart size={27}/><p>{data.recipes.some(recipe => recipe.favorite) ? '沒有符合搜尋的最愛食譜' : '先收藏幾款食譜，就可以在這裏安排餐點。'}</p></div>}</div><label className="form-label">這餐需要幾人份？<input className="field" type="number" min="1" max="100" step="1" value={servings} onChange={event => setServings(Number(event.target.value))}/></label><div className="modal-actions"><button className="button secondary" onClick={() => setAdding(null)}>取消</button><button className="button primary" onClick={addMeal} disabled={!recipeId || !Number.isInteger(servings) || servings < 1 || servings > 100}>加入計劃</button></div></Modal>}
    {generating && <Modal title="為這一週準備食材" onClose={() => setGenerating(false)} className="compact-modal"><p className="muted">將按 {weekMeals.length} 款食譜各自的食用人數計算份量，相同名稱與單位的食材會合併。</p><div className="planner-generate-option"><h3>重新建立清單</h3><p>取代現有的 {data.shopping.length} 項食材及已購買記錄，避免重複累加。</p><button className="button primary" onClick={() => createShopping(true)}>確認取代並建立清單</button></div><div className="planner-generate-option"><h3>加入現有清單</h3><p>保留目前清單，再加上本週份量。若你已加入本週食材，重複操作會再次累加。</p><button className="button secondary" onClick={() => createShopping(false)}>確認合併並累加份量</button></div><div className="modal-actions"><button className="button secondary" onClick={() => setGenerating(false)}>取消</button></div></Modal>}
  </div>;
}
