import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ChefHat, ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { useCookbook } from '../store';
import type { AppData, CookingStep, Difficulty, Ingredient, Recipe } from '../types';
import { isSafeWebUrl, validateAppData } from '../lib/backup';
import { readImage } from '../lib/images';
import { ConfirmDialog, Modal } from './ui';
import '../recipe.css';

function newIngredient(): Ingredient { return { id: crypto.randomUUID(), name: '', amount: null, unit: 'g', optional: false, seasoning: false }; }
function newStep(): CookingStep { return { id: crypto.randomUUID(), instruction: '', timerSeconds: 0 }; }
function blankRecipe(categoryId: string): Recipe {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', description: '', image: '', categoryId, tags: [], prepMinutes: 10, cookMinutes: 20, servings: 2, difficulty: '簡單', tool: '', sourceName: '', sourceUrl: '', notes: '', rating: 0, ingredients: [newIngredient()], steps: [newStep()], favorite: false, createdAt: now, updatedAt: now };
}

export default function RecipeEditor({ recipe, onClose, onSaved }: { recipe?: Recipe; onClose: () => void; onSaved: (id: string) => void }) {
  const { data, update, notify } = useCookbook();
  const initial = useRef<Recipe>(recipe ? structuredClone(recipe) : blankRecipe(data.categories[0]?.id ?? ''));
  const [draft, setDraft] = useState<Recipe>(initial.current);
  const [tags, setTags] = useState(initial.current.tags.join('、'));
  const [imagePending, setImagePending] = useState(0);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const setField = <K extends keyof Recipe>(field: K, value: Recipe[K]) => setDraft(previous => ({ ...previous, [field]: value }));
  const editIngredient = (id: string, changes: Partial<Ingredient>) => setDraft(previous => ({ ...previous, ingredients: previous.ingredients.map(item => item.id === id ? { ...item, ...changes } : item) }));
  const editStep = (id: string, changes: Partial<CookingStep>) => setDraft(previous => ({ ...previous, steps: previous.steps.map(item => item.id === id ? { ...item, ...changes } : item) }));
  const requestClose = () => {
    const changed = JSON.stringify(draft) !== JSON.stringify(initial.current) || tags !== initial.current.tags.join('、');
    if (changed || imagePending) setDiscard(true); else onClose();
  };
  const upload = async (file: File | undefined, stepId?: string) => {
    if (!file) return;
    setImagePending(value => value + 1); setError('');
    try { const image = await readImage(file); if (stepId) editStep(stepId, { image }); else setField('image', image); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '圖片讀取失敗，請試另一張圖片。'); }
    finally { setImagePending(value => value - 1); }
  };
  const moveStep = (index: number, direction: -1 | 1) => setDraft(previous => {
    const steps = [...previous.steps]; const destination = index + direction;
    if (destination < 0 || destination >= steps.length) return previous;
    [steps[index], steps[destination]] = [steps[destination], steps[index]];
    return { ...previous, steps };
  });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    if (imagePending) return;
    if (draft.title.trim().length < 2) { setError('請輸入至少兩個字的食譜名稱。'); return; }
    if (!data.categories.some(category => category.id === draft.categoryId)) { setError('請選擇一個食譜分類。'); return; }
    if (draft.prepMinutes + draft.cookMinutes < 1) { setError('準備及烹調時間合共至少需要 1 分鐘。'); return; }
    if (!draft.ingredients.length || draft.ingredients.some(item => !item.name.trim() || (item.amount !== null && (!Number.isFinite(item.amount) || item.amount <= 0)))) { setError('請為每項食材填寫名稱及有效份量；適量可留空。'); return; }
    if (!draft.steps.length || draft.steps.some(step => !step.instruction.trim())) { setError('請填寫每一步的煮食說明。'); return; }
    if (draft.sourceUrl.trim() && !isSafeWebUrl(draft.sourceUrl.trim())) { setError('參考網址需要以 https:// 或 http:// 開頭，並且不能包含登入資料。'); return; }
    const saved: Recipe = { ...draft, title: draft.title.trim(), description: draft.description.trim(), tool: draft.tool.trim(), sourceName: draft.sourceName.trim(), sourceUrl: draft.sourceUrl.trim(), tags: [...new Set(tags.split(/[、,，\n]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 20), ingredients: draft.ingredients.map(item => ({ ...item, name: item.name.trim(), unit: item.unit.trim() })), steps: draft.steps.map(step => ({ ...step, instruction: step.instruction.trim() })), updatedAt: new Date().toISOString() };
    const applySave = (value: AppData) => {
      const index = value.recipes.findIndex(item => item.id === saved.id);
      if (index === -1) value.recipes.unshift(saved); else value.recipes[index] = saved;
      const progress = value.cooking[saved.id];
      if (progress) { progress.checkedIngredients = progress.checkedIngredients.filter(id => saved.ingredients.some(item => item.id === id)); progress.completedSteps = progress.completedSteps.filter(id => saved.steps.some(item => item.id === id)); progress.stepIndex = Math.min(progress.stepIndex, saved.steps.length - 1); }
    };
    try { const candidate = structuredClone(data); applySave(candidate); validateAppData(candidate); }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace('備份格式不正確：', '請檢查食譜資料：') : '食譜資料有誤，請檢查後再儲存。'); return; }
    if (!update(applySave)) { setError('目前未能儲存，請按畫面提示重新連接或讀取最新資料。這份草稿仍保留在表單。'); return; }
    notify(recipe ? '食譜內容已更新，正在儲存' : '新食譜已加入你的食譜庫');
    onSaved(saved.id);
  };
  return <>
    <Modal title={recipe ? '編輯食譜' : '新增食譜'} onClose={requestClose} className="recipe-editor-modal">
      <form className="recipe-editor" onSubmit={save}>
        <p className="editor-intro">把喜歡的味道留低。先填寫基本資料，食材和步驟可以慢慢加。</p>
        <div className="editor-cover">{draft.image ? <img src={draft.image} alt="食譜封面預覽"/> : <div className="editor-cover-placeholder"><ChefHat size={35}/><span>加一張照片，記低這道菜的模樣</span></div>}<label className="button secondary image-upload"><ImagePlus size={17}/>{draft.image ? '更換封面' : '上傳封面'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={imagePending > 0} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/></label>{draft.image && <button type="button" className="icon-button image-remove" aria-label="移除封面圖片" disabled={imagePending > 0} onClick={() => setField('image', '')}><X size={17}/></button>}</div>
        <div className="editor-grid"><label className="editor-field full">食譜名稱 <span className="required">*</span><input className="field-input" required minLength={2} maxLength={100} autoFocus value={draft.title} onChange={event => setField('title', event.target.value)} placeholder="例如：薑蔥雞腿肉"/></label><label className="editor-field full">簡短介紹<textarea className="field-input" rows={3} maxLength={2000} value={draft.description} onChange={event => setField('description', event.target.value)} placeholder="這道菜有甚麼特別？甚麼時候最想煮？"/></label><label className="editor-field">料理分類 <span className="required">*</span><select className="field-input" required value={draft.categoryId} onChange={event => setField('categoryId', event.target.value)}>{data.categories.map(category => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label><label className="editor-field">標籤<input className="field-input" value={tags} maxLength={500} onChange={event => setTags(event.target.value)} placeholder="快手、下飯、家常菜（以逗號分隔）"/></label><label className="editor-field">準備時間（分鐘）<input className="field-input" type="number" required min={0} max={1440} value={draft.prepMinutes} onChange={event => setField('prepMinutes', Number(event.target.value))}/></label><label className="editor-field">烹調時間（分鐘）<input className="field-input" type="number" required min={0} max={1440} value={draft.cookMinutes} onChange={event => setField('cookMinutes', Number(event.target.value))}/></label><label className="editor-field">份量（人份）<input className="field-input" type="number" required min={1} max={100} value={draft.servings} onChange={event => setField('servings', Number(event.target.value))}/></label><label className="editor-field">難度<select className="field-input" value={draft.difficulty} onChange={event => setField('difficulty', event.target.value as Difficulty)}><option>簡單</option><option>適中</option><option>挑戰</option></select></label><label className="editor-field full">烹調工具<input className="field-input" maxLength={100} value={draft.tool} onChange={event => setField('tool', event.target.value)} placeholder="例如：氣炸鍋、平底鑊、微波爐"/></label></div>
        <section className="editor-section"><div className="recipe-section-heading"><h3>食材及調味料 <span className="required">*</span></h3><button type="button" className="button secondary compact" disabled={draft.ingredients.length >= 300} onClick={() => setField('ingredients', [...draft.ingredients, newIngredient()])}><Plus size={16}/>新增食材</button></div><p className="recipe-helper">份量留空表示「適量」。勾選調味料後，詳情頁會分開顯示。</p><div className="editor-ingredient-list">{draft.ingredients.map((ingredient, index) => <div className="editor-ingredient" key={ingredient.id}><div className="ingredient-fields"><label className="ingredient-name-field"><span className="sr-only">食材 {index + 1} 名稱</span><input className="field-input" required maxLength={100} placeholder="食材名稱" value={ingredient.name} onChange={event => editIngredient(ingredient.id, { name: event.target.value })}/></label><label><span className="sr-only">食材 {index + 1} 份量</span><input className="field-input" type="number" min={0.001} max={100000} step="any" placeholder="適量" value={ingredient.amount ?? ''} onChange={event => editIngredient(ingredient.id, { amount: event.target.value === '' ? null : Number(event.target.value) })}/></label><label><span className="sr-only">食材 {index + 1} 單位</span><input className="field-input" maxLength={20} placeholder="單位" list="ingredient-units" value={ingredient.unit} onChange={event => editIngredient(ingredient.id, { unit: event.target.value })}/></label><button type="button" className="icon-button destructive" disabled={draft.ingredients.length <= 1} aria-label={`刪除食材 ${index + 1}`} onClick={() => setField('ingredients', draft.ingredients.filter(item => item.id !== ingredient.id))}><Trash2 size={17}/></button></div><div className="ingredient-options"><label><input type="checkbox" checked={ingredient.seasoning} onChange={event => editIngredient(ingredient.id, { seasoning: event.target.checked })}/>調味料</label><label><input type="checkbox" checked={ingredient.optional} onChange={event => editIngredient(ingredient.id, { optional: event.target.checked })}/>可選食材</label></div></div>)}</div><datalist id="ingredient-units">{['g', 'kg', 'ml', 'L', '茶匙', '湯匙', '個', '片', '條', '瓣', '碗', '杯', '撮'].map(unit => <option key={unit} value={unit}/>)}</datalist></section>
        <section className="editor-section"><div className="recipe-section-heading"><h3>烹調步驟 <span className="required">*</span></h3><button type="button" className="button secondary compact" disabled={draft.steps.length >= 300} onClick={() => setField('steps', [...draft.steps, newStep()])}><Plus size={16}/>新增步驟</button></div><div className="editor-step-list">{draft.steps.map((step, index) => <div className="editor-step" key={step.id}><div className="editor-step-heading"><strong><span>{index + 1}</span>第 {index + 1} 步</strong><div><button type="button" className="icon-button" disabled={index === 0} aria-label={`第 ${index + 1} 步向上移`} onClick={() => moveStep(index, -1)}><ArrowUp size={16}/></button><button type="button" className="icon-button" disabled={index === draft.steps.length - 1} aria-label={`第 ${index + 1} 步向下移`} onClick={() => moveStep(index, 1)}><ArrowDown size={16}/></button><button type="button" className="icon-button destructive" disabled={draft.steps.length <= 1} aria-label={`刪除第 ${index + 1} 步`} onClick={() => setField('steps', draft.steps.filter(item => item.id !== step.id))}><Trash2 size={16}/></button></div></div><label><span className="sr-only">第 {index + 1} 步說明</span><textarea className="field-input" required rows={3} maxLength={5000} placeholder="清楚寫下這一步，例如溫度、時間及注意事項……" value={step.instruction} onChange={event => editStep(step.id, { instruction: event.target.value })}/></label><div className="editor-step-options"><label className="editor-timer">倒數時間（分鐘）<input className="field-input" type="number" min={0} max={1440} step="any" value={(step.timerSeconds ?? 0) / 60} onChange={event => editStep(step.id, { timerSeconds: Math.round(Number(event.target.value) * 60) })}/></label><label className="button secondary compact image-upload"><ImagePlus size={16}/>{step.image ? '更換步驟圖片' : '加入步驟圖片'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={imagePending > 0} onChange={event => { void upload(event.target.files?.[0], step.id); event.target.value = ''; }}/></label></div>{step.image && <div className="editor-step-image"><img src={step.image} alt={`第 ${index + 1} 步圖片預覽`}/><button type="button" className="icon-button image-remove" aria-label={`移除第 ${index + 1} 步圖片`} onClick={() => editStep(step.id, { image: undefined })}><X size={16}/></button></div>}</div>)}</div></section>
        <section className="editor-section"><h3>備註及來源</h3><div className="editor-grid"><label className="editor-field full">個人備註<textarea className="field-input" rows={3} maxLength={10000} value={draft.notes} onChange={event => setField('notes', event.target.value)} placeholder="替代食材、口味調整，或你的小秘訣……"/></label><label className="editor-field">來源名稱<input className="field-input" maxLength={200} value={draft.sourceName} onChange={event => setField('sourceName', event.target.value)} placeholder="例如：媽媽的食譜、食譜書"/></label><label className="editor-field">參考網址<input className="field-input" type="url" maxLength={2000} value={draft.sourceUrl} onChange={event => setField('sourceUrl', event.target.value)} placeholder="https://（可選）"/></label></div></section>
        {error && <p className="editor-error" role="alert">{error}</p>}{imagePending > 0 && <p className="recipe-helper" role="status">正在處理圖片……</p>}
        <div className="editor-footer"><button type="button" className="button secondary" onClick={requestClose}>取消</button><button className="button primary" type="submit" disabled={imagePending > 0}><Save size={18}/>{imagePending > 0 ? '處理圖片中……' : '儲存食譜'}</button></div>
      </form>
    </Modal>
    {discard && <ConfirmDialog title="放棄未儲存的修改？" description="你剛剛填寫的內容尚未儲存。返回繼續編輯，或放棄本次修改。" confirmLabel="放棄修改" onConfirm={onClose} onClose={() => setDiscard(false)}/>}
  </>;
}
