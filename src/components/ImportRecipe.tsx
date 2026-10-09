import { useState } from 'react';
import { FileText, Globe, Info, Sparkles } from 'lucide-react';
import { useCookbook } from '../store';
import { isSafeImage, isSafeWebUrl } from '../lib/backup';
import type { Ingredient, Recipe } from '../types';
import { Modal } from './ui';
import '../organize.css';

const quantityPattern = String.raw`\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?`;
const unitsPattern = '(?:湯匙|茶匙|大匙|小匙|毫升|公斤|公克|kg|ml|克|升|g|l|杯|個|隻|件|塊|片|粒|條|棵|瓣|包|罐|碗|撮|匙)';
function amountNumber(value: string) { const parts = value.split('/').map(part => Number(part.trim())); return parts.length === 2 ? parts[0] / parts[1] : parts[0]; }
function stripBullet(line: string) { return line.replace(/^\s*(?:[-*•·]\s*|\d+[.)、．]\s+)/, '').trim(); }

export function parseIngredient(raw: string, seasoning = false): Ingredient {
  const line = stripBullet(raw);
  let name = line;
  let amount: number | null = null;
  let unit = '';
  // Ranges and mixed fractions remain verbatim for review; do not guess their quantities.
  const ambiguous = /\d\s*[-–~～至]\s*\d|\d\s+\d\s*\/\s*\d|[½¼¾]/.test(line);
  if (!ambiguous) {
    const prefix = line.match(new RegExp(`^(${quantityPattern})\\s*(${unitsPattern})\\s+(.+)$`, 'i'));
    const suffix = line.match(new RegExp(`^(.+?)\\s*[:：]?\\s*(${quantityPattern})\\s*(${unitsPattern})(.*)$`, 'i'));
    if (prefix) { amount = amountNumber(prefix[1]); unit = prefix[2]; name = prefix[3]; }
    else if (suffix) { name = `${suffix[1].replace(/[:：]\s*$/, '').trim()}${suffix[4] ? ` ${suffix[4].trim()}` : ''}`.trim(); amount = amountNumber(suffix[2]); unit = suffix[3]; }
    else if (/(?:適量|少許)$/.test(line)) { name = line.replace(/\s*[:：]?\s*(?:適量|少許)$/, '').trim(); unit = ''; }
  }
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) throw new Error(`「${raw}」的份量無法讀取，請先改成清楚的數字。`);
  if (!name || name.length > 200) throw new Error('食材名稱需為 1 至 200 個字。請將過長的食材說明分開。');
  return { id: crypto.randomUUID(), name, amount, unit, optional: /可選|可省略|optional/i.test(line), seasoning };
}

function emptyRecipe(categoryId: string): Recipe {
  const timestamp = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '待確認食譜', description: '', image: '', categoryId, tags: [], prepMinutes: 0, cookMinutes: 0, servings: 1, difficulty: '簡單', tool: '', sourceName: '個人貼上的內容（待確認）', sourceUrl: '', notes: '', rating: 0, ingredients: [], steps: [], favorite: false, createdAt: timestamp, updatedAt: timestamp };
}
function minuteValue(line: string, labels: string): number | undefined {
  const match = line.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*(\\d+)\\s*(分鐘|分|min|minutes?|小時|hours?)`, 'i'));
  if (!match) return undefined;
  const value = Number(match[1]) * (/小時|hours?/i.test(match[2]) ? 60 : 1);
  if (value > 10080) throw new Error('烹調時間過長，請檢查原始文字。');
  return value;
}

export function parseRecipeText(text: string, categoryId: string): Recipe {
  if (text.length > 15000) throw new Error('文字太長，請將內容縮短至 15,000 字以內。');
  const lines = text.split(/\r?\n/).map(line => line.replace(/^\s*#{1,6}\s*/, '').trim()).filter(Boolean);
  if (lines.length < 3) throw new Error('請貼上包含食譜名稱、食材及烹調步驟的完整文字。');
  const recipe = emptyRecipe(categoryId);
  let section: 'intro' | 'ingredients' | 'seasoning' | 'steps' | 'notes' = 'intro';
  let titleSet = false;
  const intro: string[] = [];
  const steps: string[] = [];
  let sawTime = false;
  let sawServings = false;
  for (const line of lines) {
    if (/^(?:食材|材料|主材料|主要食材|配料)(?:[（(].*[）)])?\s*[:：]?$/.test(line)) { section = 'ingredients'; continue; }
    if (/^(?:調味料|調味|醬汁|醃料)(?:[（(].*[）)])?\s*[:：]?$/.test(line)) { section = 'seasoning'; continue; }
    if (/^(?:做法|步驟|烹調步驟|烹調方法|製作方法|製作步驟|料理步驟)\s*[:：]?$/.test(line)) { section = 'steps'; continue; }
    if (/^(?:備註|小貼士|注意事項)\s*[:：]?$/.test(line)) { section = 'notes'; continue; }
    if (section === 'intro') {
      const prep = minuteValue(line, '準備時間|預備時間');
      const cook = minuteValue(line, '烹調時間|烹飪時間|煮食時間');
      const serving = line.match(/(?:份量\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(?:人份|人用|人食用|人)/);
      if (prep !== undefined || cook !== undefined || serving) {
        if (prep !== undefined) { recipe.prepMinutes = prep; sawTime = true; }
        if (cook !== undefined) { recipe.cookMinutes = cook; sawTime = true; }
        if (serving && Number(serving[1]) >= 0.25 && Number(serving[1]) <= 1000) { recipe.servings = Number(serving[1]); sawServings = true; }
        continue;
      }
      if (!titleSet) { recipe.title = line.replace(/^(?:食譜名稱|名稱)\s*[:：]\s*/, '').slice(0, 200); titleSet = true; }
      else intro.push(line);
    } else if (section === 'ingredients' || section === 'seasoning') recipe.ingredients.push(parseIngredient(line, section === 'seasoning'));
    else if (section === 'steps') {
      const numbered = line.match(/^(?:(?:步驟|step)\s*)?\d+\s*[.)、．:：]\s*(.*)$/i) || line.match(/^(?:步驟|step)\s*\d+\s+(.+)$/i);
      if (numbered) steps.push(numbered[1]);
      else if (steps.length && /^[-•*]/.test(line)) steps[steps.length - 1] += `\n${stripBullet(line)}`;
      else steps.push(line);
    }
  }
  if (!recipe.ingredients.length || !steps.length) throw new Error('未能找到完整食材或步驟。請在食材前加「食材」，在烹調說明前加「做法」，每項內容獨立一行。');
  if (recipe.ingredients.length > 300 || steps.length > 300) throw new Error('每款食譜最多可有 300 項食材及 300 個步驟。');
  recipe.description = intro.join('\n').slice(0, 10000);
  recipe.steps = steps.filter(Boolean).map(instruction => ({ id: crypto.randomUUID(), instruction }));
  const warnings = [!sawTime && '未列明準備／烹調時間，暫填 0 分鐘。', !sawServings && '未列明人數，暫填 1 人份。', recipe.ingredients.some(item => item.amount === null) && '部分食材沒有清楚數量，已保留文字，請核對。'].filter(Boolean);
  recipe.notes = [`文字匯入待確認：${warnings.join(' ')} 難度暫設「簡單」，請確認。`, '\n原始食譜文字（含備註，供核對）：', text].join('\n');
  return recipe;
}

type StructuredRecipe = Record<string, unknown>;
function findRecipe(value: unknown): StructuredRecipe | undefined {
  if (Array.isArray(value)) { for (const entry of value) { const found = findRecipe(entry); if (found) return found; } return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const object = value as StructuredRecipe;
  if ((Array.isArray(object['@type']) ? object['@type'] : [object['@type']]).some(type => typeof type === 'string' && /(?:^|\/)Recipe$/i.test(type))) return object;
  for (const entry of Object.values(object)) { if (entry && typeof entry === 'object') { const found = findRecipe(entry); if (found) return found; } }
  return undefined;
}
function plainText(value: unknown) { return typeof value === 'string' ? new DOMParser().parseFromString(value, 'text/html').body.textContent?.trim() || '' : ''; }
function instructionTexts(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\r?\n/).map(plainText).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(instructionTexts);
  if (!value || typeof value !== 'object') return [];
  const object = value as StructuredRecipe;
  if (object.itemListElement) return instructionTexts(object.itemListElement);
  return object.text ? instructionTexts(object.text) : [];
}
function durationMinutes(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = value.match(/^P(?:([\d.]+)D)?T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/i);
  if (!match) return 0;
  return Math.min(10080, Math.ceil(Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0) + Number(match[4] || 0) / 60));
}

export function parseWebRecipe(content: string, categoryId: string, sourceUrl: string): Recipe {
  if (content.length > 500000) throw new Error('網頁內容太長，請只貼上 Recipe 的 JSON-LD 區塊。');
  if (sourceUrl && !isSafeWebUrl(sourceUrl)) throw new Error('來源網址需要是完整的 http 或 https 網址。');
  let structured: StructuredRecipe | undefined;
  try { structured = findRecipe(JSON.parse(content)); } catch { /* Try an HTML document containing JSON-LD. */ }
  if (!structured) {
    const document = new DOMParser().parseFromString(content, 'text/html');
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { structured = findRecipe(JSON.parse(script.textContent || '')); if (structured) break; } catch { /* Ignore unrelated malformed JSON-LD. */ }
    }
  }
  if (!structured) throw new Error('找不到 Recipe 格式的 JSON-LD。請貼上網頁的完整 HTML 或包含 @type: "Recipe" 的 JSON-LD；只有網址不足以讀取內容。');
  const recipe = emptyRecipe(categoryId);
  recipe.title = plainText(structured.name).slice(0, 200) || '待確認網頁食譜';
  recipe.description = plainText(structured.description).slice(0, 10000);
  if (!Array.isArray(structured.recipeIngredient) || !structured.recipeIngredient.length) throw new Error('網頁資料沒有 recipeIngredient 食材清單，請改用文字匯入。');
  recipe.ingredients = structured.recipeIngredient.filter(value => typeof value === 'string').map(value => parseIngredient(plainText(value)));
  recipe.steps = instructionTexts(structured.recipeInstructions).map(instruction => ({ id: crypto.randomUUID(), instruction }));
  if (!recipe.steps.length) throw new Error('網頁資料沒有 recipeInstructions 烹調步驟，請改用文字匯入。');
  if (recipe.ingredients.length > 300 || recipe.steps.length > 300) throw new Error('食材或步驟過多，請先整理原始內容。');
  recipe.prepMinutes = durationMinutes(structured.prepTime);
  recipe.cookMinutes = durationMinutes(structured.cookTime);
  const yieldText = Array.isArray(structured.recipeYield) ? structured.recipeYield.map(String).join(' / ') : String(structured.recipeYield || '');
  const yieldNumber = yieldText.match(/^(\d+(?:\.\d+)?)\s*(?:servings?|人份|人)?$/i);
  if (yieldNumber && Number(yieldNumber[1]) >= 0.25 && Number(yieldNumber[1]) <= 1000) recipe.servings = Number(yieldNumber[1]);
  let image = structured.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = (image as StructuredRecipe).url;
  if (typeof image === 'string' && isSafeImage(image)) recipe.image = image;
  recipe.sourceUrl = sourceUrl;
  recipe.sourceName = '貼上的網頁 JSON-LD';
  const timeNote = `原始時間：準備 ${String(structured.prepTime || '未列明')}；烹調 ${String(structured.cookTime || '未列明')}；總時間 ${String(structured.totalTime || '未列明')}。秒數會向上取整至分鐘。`;
  recipe.notes = `網頁內容匯入待確認。份量：${yieldText || '未列明，暫填 1 人份'}。難度暫設簡單；調味料需自行分類。${timeNote}\n原始食材：\n${structured.recipeIngredient.join('\n')}`.slice(0, 20000);
  return recipe;
}

const sample = '港式黑椒雞腿扒\n準備時間：10 分鐘\n烹調時間：15 分鐘\n份量：2 人份\n\n食材\n雞腿扒 400 g\n洋蔥 1 個\n\n調味料\n豉油 1 湯匙\n黑椒 1 茶匙\n\n做法\n1. 雞腿扒抹乾，加入豉油及黑椒醃 10 分鐘。\n2. 平底鑊下油，中火煎雞扒至兩面金黃。\n3. 加入洋蔥炒香，煮至雞肉中心達 75°C，便可上碟。';

export default function ImportRecipe({ onClose, onReview }: { onClose: () => void; onReview: (recipe: Recipe) => void }) {
  const { data } = useCookbook();
  const [mode, setMode] = useState<'text' | 'web'>('text');
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState(data.categories.find(category => category.id === 'category-other' || category.name === '其他')?.id || data.categories[0]?.id || 'category-other');
  const review = () => {
    setError('');
    try {
      if (sourceUrl && !isSafeWebUrl(sourceUrl)) throw new Error('來源網址需要是完整的 http 或 https 網址。');
      const recipe = mode === 'text' ? parseRecipeText(text, categoryId) : parseWebRecipe(text, categoryId, sourceUrl);
      recipe.sourceUrl = sourceUrl;
      onReview(recipe);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '無法整理內容，請檢查格式。'); }
  };
  return <Modal title="匯入你的食譜" onClose={onClose} className="import-modal"><p className="muted">貼上內容，整理成可編輯的食譜。確認及修改後才會儲存。</p><div className="import-tabs"><button className={mode === 'text' ? 'active' : ''} onClick={() => { setMode('text'); setText(''); setError(''); }}><FileText size={17}/>文字匯入</button><button className={mode === 'web' ? 'active' : ''} onClick={() => { setMode('web'); setText(''); setError(''); }}><Globe size={17}/>網頁內容</button></div><div className="import-info"><Info size={18}/><p>{mode === 'text' ? '採用本機規則整理，並非 AI。請使用「食材」、「調味料」及「做法」標題，每項內容獨立一行。無法識別的數量會保留文字，請在下一頁核對。' : '讀取你貼上的 Recipe JSON-LD 或包含該資料的網頁 HTML。本版不直接擷取外部網址，避免網站的存取限制；來源連結仍會保存。內容只在本機處理。'}</p></div><label className="form-label">{mode === 'text' ? '食譜文字' : '網頁 HTML / Recipe JSON-LD'}<textarea className="field import-textarea" value={text} maxLength={mode === 'text' ? 15000 : 500000} onChange={event => setText(event.target.value)} placeholder={mode === 'text' ? '食譜名稱\n準備時間：10 分鐘\n份量：2 人份\n\n食材\n雞腿肉 400 g\n\n做法\n1. …\n2. …' : '{ "@context": "https://schema.org", "@type": "Recipe", "name": "…", "recipeIngredient": ["…"], "recipeInstructions": ["…"] }'}/></label>{mode === 'text' && <button className="text-button import-example" onClick={() => setText(sample)}>填入示範格式</button>}<div className="organize-form-grid"><label className="form-label">分類<select className="field" value={categoryId} onChange={event => setCategoryId(event.target.value)}>{data.categories.map(category => <option value={category.id} key={category.id}>{category.emoji} {category.name}</option>)}</select></label><label className="form-label">來源網址（選填）<input className="field" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…"/></label></div>{error && <p className="organize-error" role="alert">{error}</p>}<div className="import-ai-notice"><Sparkles size={17}/><p>圖片辨識、日文翻譯及 AI 整理尚未連接。日後啟用需要另外設定模型服務、API Key 及確認費用，現在不會傳送內容或產生費用。</p></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={review} disabled={!text.trim()}>整理並檢閱食譜</button></div></Modal>;
}
