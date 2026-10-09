import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChefHat, Clock3, ListChecks, Pause, Play, RotateCcw, UtensilsCrossed } from 'lucide-react';
import type { CookingProgress } from '../types';
import { useCookbook } from '../store';
import { formatAmount, scaledAmount } from '../lib/recipes';
import { Modal } from './ui';
import { createProgress, setCookingStep, updateProgress } from './RecipeDetail';
import '../recipe.css';

function clock(seconds: number) { const value = Math.max(0, Math.ceil(seconds)); return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`; }

export default function CookingMode({ recipeId, onClose }: { recipeId: string; onClose: () => void }) {
  const { data, update, notify } = useCookbook();
  const recipe = data.recipes.find(item => item.id === recipeId);
  const progress = recipe ? data.cooking[recipeId] ?? createProgress(recipe) : undefined;
  const [now, setNow] = useState(Date.now());
  const [showIngredients, setShowIngredients] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState('5');
  const [timerError, setTimerError] = useState('');
  const [timerFinished, setTimerFinished] = useState(false);
  const currentIndex = recipe && progress ? Math.min(progress.stepIndex, Math.max(0, recipe.steps.length - 1)) : 0;
  const step = recipe?.steps[currentIndex];
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (recipe && !data.cooking[recipeId]) update(draft => { draft.cooking[recipeId] = createProgress(recipe); });
  }, [recipeId, recipe, data.cooking, update]);
  useEffect(() => { setTimerMinutes(step?.timerSeconds ? String(step.timerSeconds / 60) : '5'); setTimerError(''); }, [step?.id, step?.timerSeconds]);
  useEffect(() => {
    if (!recipe || !progress?.timerEndsAt || progress.timerEndsAt > now) return;
    update(draft => updateProgress(draft, recipe, value => { value.timerEndsAt = null; value.timerRemaining = 0; }));
    setTimerFinished(true);
    notify('煮食倒數完成！請檢查食物的熟度。');
  }, [now, progress?.timerEndsAt, recipe, update, notify]);
  useEffect(() => {
    let released = false;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      if (released || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || lock) return;
      try { const result = await navigator.wakeLock.request('screen'); if (released) await result.release(); else { lock = result; result.addEventListener('release', () => { lock = null; }); } } catch { /* Unsupported devices continue normally. */ }
    };
    void request(); document.addEventListener('visibilitychange', request);
    return () => { released = true; document.removeEventListener('visibilitychange', request); if (lock) void lock.release(); };
  }, []);
  if (!recipe || !progress || !step) return <Modal title="煮食模式" onClose={onClose}><p>這款食譜沒有可用的煮食步驟。</p></Modal>;
  const running = progress.timerEndsAt !== null;
  const remaining = running ? Math.max(0, Math.ceil(((progress.timerEndsAt ?? now) - now) / 1000)) : progress.timerRemaining;
  const changeProgress = (mutate: (value: CookingProgress) => void) => update(draft => updateProgress(draft, recipe, mutate));
  const navigate = (index: number) => {
    if (index < 0 || index >= recipe.steps.length) return;
    changeProgress(value => setCookingStep(value, recipe, index));
    setTimerFinished(false);
  };
  const toggleComplete = () => changeProgress(value => { value.completedSteps = value.completedSteps.includes(step.id) ? value.completedSteps.filter(id => id !== step.id) : [...value.completedSteps, step.id]; });
  const startPause = () => {
    setNow(Date.now()); setTimerFinished(false);
    changeProgress(value => {
      if (value.timerEndsAt) { value.timerRemaining = Math.max(0, Math.ceil((value.timerEndsAt - Date.now()) / 1000)); value.timerEndsAt = null; }
      else if (value.timerRemaining > 0) value.timerEndsAt = Date.now() + value.timerRemaining * 1000;
    });
  };
  const completed = progress.completedSteps.includes(step.id);
  const allCompleted = recipe.steps.every(item => progress.completedSteps.includes(item.id));
  return <Modal title="專心煮食" onClose={onClose} className="cooking-mode-modal">
    <div className="cooking-shell"><header className="cooking-topbar"><div><span className="section-eyebrow">把日常，煮成喜歡的模樣</span><h2>{recipe.title}</h2></div><button className={`button secondary ${showIngredients ? 'selected' : ''}`} aria-expanded={showIngredients} aria-controls="cooking-ingredients" onClick={() => setShowIngredients(value => !value)}><ListChecks size={18}/>{showIngredients ? '收起食材' : '查看食材'}</button></header>
      <div className="cooking-overall-progress"><div><span>第 {currentIndex + 1} / {recipe.steps.length} 步</span><span>{progress.completedSteps.length} 步已完成</span></div><div className="cooking-progress-track"><span style={{ width: `${progress.completedSteps.length / recipe.steps.length * 100}%` }}/></div></div>
      <div className={`cooking-columns ${showIngredients ? 'with-ingredients' : ''}`}>
        <div className="cooking-main"><article className="cooking-current-step"><span className="cooking-step-kicker">步驟 {String(currentIndex + 1).padStart(2, '0')}</span><p>{step.instruction}</p>{step.image && <img className="cooking-step-image" src={step.image} alt={`第 ${currentIndex + 1} 步示範`}/>}<button className={`button ${completed ? 'secondary step-done' : 'primary'}`} onClick={toggleComplete}>{completed ? <CheckCircle2 size={19}/> : <Check size={19}/>} {completed ? '已完成 · 點按可取消' : '完成這一步'}</button></article>
          <section className={`cooking-timer ${timerFinished ? 'timer-finished' : ''}`} aria-label="煮食倒數計時器"><div className="timer-title"><Clock3 size={19}/><strong>你的煮食小幫手</strong>{running && <span className="timer-running">倒數中</span>}</div><div className="timer-display" role="timer" aria-label={`剩餘 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`}>{clock(remaining)}</div>{timerFinished && <p className="timer-complete-message" role="status">時間到！記得檢查食物的熟度。</p>}<div className="timer-controls"><button className="button primary" disabled={!running && remaining === 0} onClick={startPause}>{running ? <Pause size={17}/> : <Play size={17}/>} {running ? '暫停' : '開始'}</button><button className="button secondary" onClick={() => { changeProgress(value => { value.timerEndsAt = null; value.timerRemaining = step.timerSeconds ?? 0; }); setTimerFinished(false); }}><RotateCcw size={17}/>重設</button><button className="button secondary" onClick={() => { changeProgress(value => { if (value.timerEndsAt) value.timerEndsAt = Math.min(value.timerEndsAt + 60000, Date.now() + 86400000); value.timerRemaining = Math.min(86400, value.timerRemaining + 60); }); setTimerFinished(false); }}>+1 分鐘</button></div><form className="timer-manual" onSubmit={event => { event.preventDefault(); const minutes = Number(timerMinutes); if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) { setTimerError('請輸入 0.1 至 1440 分鐘。'); return; } changeProgress(value => { value.timerEndsAt = null; value.timerRemaining = Math.round(minutes * 60); }); setTimerError(''); setTimerFinished(false); }}><label htmlFor="cooking-timer-minutes">自訂倒數</label><input id="cooking-timer-minutes" className="field-input" type="number" min={0.1} max={1440} step="0.1" required value={timerMinutes} disabled={running} onChange={event => setTimerMinutes(event.target.value)}/><span>分鐘</span><button className="button secondary compact" type="submit" disabled={running}>設定</button></form>{timerError && <p className="editor-error" role="alert">{timerError}</p>}<p className="timer-footnote">倒數及煮食進度會自動儲存，重新整理亦可繼續。</p></section>
          {allCompleted && <div className="cooking-celebration"><UtensilsCrossed size={23}/><div><strong>完成了，好好享受這餐！</strong><p>返回食譜，記低今次的煮食心得。</p></div><button className="button secondary" onClick={onClose}>返回食譜</button></div>}
        </div>
        {showIngredients && <aside className="cooking-ingredients" id="cooking-ingredients"><h3><ChefHat size={19}/>食材清單</h3><p>{progress.servings} 人份 · 原食譜 {recipe.servings} 人份</p>{[false, true].map(seasoning => <div className="ingredient-group" key={String(seasoning)}>{recipe.ingredients.some(item => item.seasoning === seasoning) && <h4>{seasoning ? '調味料' : '食材'}</h4>}{recipe.ingredients.filter(item => item.seasoning === seasoning).map(ingredient => <label key={ingredient.id} className={`ingredient-row ${progress.checkedIngredients.includes(ingredient.id) ? 'is-checked' : ''}`}><input type="checkbox" checked={progress.checkedIngredients.includes(ingredient.id)} onChange={() => changeProgress(value => { value.checkedIngredients = value.checkedIngredients.includes(ingredient.id) ? value.checkedIngredients.filter(id => id !== ingredient.id) : [...value.checkedIngredients, ingredient.id]; })}/><span className="ingredient-name">{ingredient.name}{ingredient.optional && <small>可選</small>}</span><span className="ingredient-amount">{formatAmount(scaledAmount(ingredient.amount, progress.servings, recipe.servings))}{ingredient.amount !== null ? ` ${ingredient.unit}` : ''}</span></label>)}</div>)}</aside>}
      </div>
      <footer className="cooking-footer"><button className="button secondary" disabled={currentIndex === 0} onClick={() => navigate(currentIndex - 1)}><ArrowLeft size={18}/>上一步</button><span>每一步，都離美味近一點</span><button className="button primary" disabled={currentIndex === recipe.steps.length - 1} onClick={() => navigate(currentIndex + 1)}>下一步<ArrowRight size={18}/></button></footer>
    </div>
  </Modal>;
}
