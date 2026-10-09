import { useState } from 'react';
import { Check, Copy, Pencil, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { useCookbook } from '../store';
import { formatAmount } from '../lib/recipes';
import type { ShoppingItem } from '../types';
import { ConfirmDialog, Modal } from './ui';
import '../organize.css';

export default function ShoppingList() {
  const { data, update, notify } = useCookbook();
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copying, setCopying] = useState(false);
  const completed = data.shopping.filter(item => item.checked).length;

  const saveItem = () => {
    if (!editing?.name.trim() || (editing.amount !== null && (!Number.isFinite(editing.amount) || editing.amount < 0 || editing.amount > 1_000_000))) return;
    const next = { ...editing, name: editing.name.trim(), unit: editing.unit.trim() };
    update(draft => {
      const index = draft.shopping.findIndex(item => item.id === next.id);
      if (index >= 0) draft.shopping[index] = next;
      else draft.shopping.push(next);
    });
    setEditing(null);
    notify('購物清單已更新');
  };

  const copyList = async () => {
    setCopying(true);
    const text = `我的購物清單\n${data.shopping.map(item => `${item.checked ? '☑' : '☐'} ${item.name} ${formatAmount(item.amount)}${item.unit && item.unit !== '適量' ? ` ${item.unit}` : ''}`).join('\n')}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try { if (!document.execCommand('copy')) throw new Error('copy'); }
        finally { textarea.remove(); }
      }
      notify('已複製購物清單');
    } catch { notify('無法存取剪貼簿，請允許瀏覽器的剪貼簿權限再試'); }
    finally { setCopying(false); }
  };

  return <div className="organize-page shopping-page">
    <div className="organize-heading"><div><p className="organize-eyebrow">一起準備，一起開飯</p><h1>購物清單</h1><p className="muted">由食譜加入食材，或記下今天要買的小東西。</p></div><button className="button primary" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', amount: null, unit: '', checked: false, recipeIds: [] })}><Plus size={18}/>新增食材</button></div>
    <div className="shopping-summary"><div className="shopping-summary-icon"><ShoppingBasket size={27}/></div><div><strong>{data.shopping.length - completed} 項待購買</strong><span>{completed} 項已買齊 · 清單會自動儲存</span></div><button className="button secondary" onClick={copyList} disabled={!data.shopping.length || copying}><Copy size={16}/>{copying ? '複製中…' : '複製清單'}</button></div>
    {data.shopping.length > 0 ? <div className="shopping-list">{data.shopping.map(item => <div key={item.id} className={`shopping-row ${item.checked ? 'is-checked' : ''}`}>
      <label className="shopping-checkbox"><input type="checkbox" checked={item.checked} aria-label={`${item.checked ? '取消已購買' : '標記已購買'}${item.name}`} onChange={() => update(draft => { const found = draft.shopping.find(i => i.id === item.id); if (found) found.checked = !found.checked; })}/><span><Check size={15}/></span></label>
      <div className="shopping-item-name"><strong>{item.name}</strong><span>{item.recipeIds.length ? `來自 ${item.recipeIds.length} 款食譜` : '自行加入'}</span></div>
      <label className="shopping-quantity"><span className="sr-only">{item.name}的數量</span><input type="number" min="0" max="1000000" step="any" value={item.amount ?? ''} placeholder="適量" onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value); if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) return; update(draft => { const found = draft.shopping.find(i => i.id === item.id); if (found) found.amount = value; }); }}/><span>{item.unit}</span></label>
      <button className="icon-button" aria-label={`編輯${item.name}`} onClick={() => setEditing({ ...item })}><Pencil size={17}/></button>
      <button className="icon-button" aria-label={`移除${item.name}`} onClick={() => update(draft => { draft.shopping = draft.shopping.filter(i => i.id !== item.id); })}><Trash2 size={17}/></button>
    </div>)}</div> : <div className="organize-empty"><ShoppingBasket size={43}/><h2>購物清單還是空白的</h2><p>在食譜詳情點「加入購物清單」，或自行新增食材。<br/>相同名稱及單位的食材會自動合併。</p></div>}
    {completed > 0 && <div className="shopping-footer"><span><Check size={16}/>{completed} 項已準備好</span><button className="text-button" onClick={() => setClearing(true)}>清除已購買項目</button></div>}
    <p className="organize-footnote">份量不明的食材會保留為「適量」。不同單位分開記錄，避免錯誤換算。</p>
    {editing && <Modal title={data.shopping.some(item => item.id === editing.id) ? '編輯食材' : '新增食材'} onClose={() => setEditing(null)} className="compact-modal"><form onSubmit={event => { event.preventDefault(); saveItem(); }}><label className="form-label">食材名稱<input className="field" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} maxLength={150} required autoFocus placeholder="例如：雞腿肉"/></label><div className="organize-form-grid"><label className="form-label">數量<input className="field" type="number" min="0" max="1000000" step="any" value={editing.amount ?? ''} placeholder="未填即適量" onChange={event => setEditing({ ...editing, amount: event.target.value === '' ? null : Number(event.target.value) })}/></label><label className="form-label">單位<input className="field" value={editing.unit} onChange={event => setEditing({ ...editing, unit: event.target.value })} maxLength={30} placeholder="g、個、湯匙"/></label></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={!editing.name.trim()}>儲存食材</button></div></form></Modal>}
    {clearing && <ConfirmDialog title="清除已購買項目？" description={`將移除 ${completed} 項已購買的食材。未購買的項目會保留。`} onClose={() => setClearing(false)} onConfirm={() => { update(draft => { draft.shopping = draft.shopping.filter(item => !item.checked); }); notify('已清除買齊的食材'); }} confirmLabel="清除已購買"/>}
  </div>;
}
