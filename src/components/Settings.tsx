import { useRef, useState } from 'react';
import { Archive, Download, Laptop, Moon, Pencil, Plus, ShieldCheck, Sun, Trash2, Upload } from 'lucide-react';
import { useCookbook } from '../store';
import { exportBackup, parseBackup, MAX_BACKUP_BYTES } from '../lib/backup';
import type { AppData, Category, Theme } from '../types';
import { ConfirmDialog, Modal } from './ui';
import '../organize.css';
import LocalFolderSettings from './LocalFolderSettings';
import { parseFolderContent } from '../lib/local-folder';

export default function Settings() {
  const { data, update, replaceData, notify, localFolder } = useCookbook();
  const fileInput = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [backup, setBackup] = useState<AppData | null>(null);
  const [backupName, setBackupName] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const safeExport = () => {
    setError('');
    try {
      exportBackup(data);
      notify('備份檔案已開始下載');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '下載備份失敗，請重試。';
      setError(message);
      notify(message);
    }
  };
  const addCategory = () => {
    const name = newName.trim();
    if (!name) return;
    if (data.categories.some(category => category.name === name)) { notify('已有同名分類，請使用另一個名稱'); return; }
    update(draft => { draft.categories.push({ id: crypto.randomUUID(), name, emoji: '🍽️' }); });
    setNewName('');
    notify('已新增分類');
  };
  const saveCategory = () => {
    if (!editing?.name.trim()) return;
    if (data.categories.some(category => category.id !== editing.id && category.name === editing.name.trim())) { notify('已有同名分類'); return; }
    update(draft => { const category = draft.categories.find(item => item.id === editing.id); if (category) { category.name = editing.name.trim(); category.emoji = editing.emoji.trim() || '🍽️'; } });
    setEditing(null);
    notify('分類已更新');
  };
  const deleteCategory = () => {
    if (!deleting || data.categories.length <= 1) return;
    update(draft => {
      const replacement = draft.categories.find(category => category.id !== deleting.id && (category.id === 'category-other' || category.name === '其他')) || draft.categories.find(category => category.id !== deleting.id);
      if (!replacement) return;
      draft.recipes.forEach(recipe => { if (recipe.categoryId === deleting.id) recipe.categoryId = replacement.id; });
      draft.categories = draft.categories.filter(category => category.id !== deleting.id);
    });
    notify('分類已刪除，食譜已保留');
  };
  const readBackup = async (file: File) => {
    setReading(true); setError(''); setBackup(null);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('備份檔案超過 50 MB，請選擇較小的 JSON 備份。');
      const content = await file.text();
      let imported: AppData;
      try { imported = parseBackup(content); }
      catch (backupError) {
        let format: unknown;
        try { format = JSON.parse(content.replace(/^\uFEFF/, '')).format; } catch { throw backupError; }
        if (format !== 'my-recipe-cookbook-folder') throw backupError;
        imported = parseFolderContent(content);
      }
      setBackup(imported); setBackupName(file.name);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '無法讀取備份，請檢查檔案格式。'); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const themes: { id: Theme; name: string; icon: typeof Sun }[] = [{ id: 'light', name: '淺色', icon: Sun }, { id: 'dark', name: '深色', icon: Moon }, { id: 'system', name: '跟隨系統', icon: Laptop }];
  const replacement = deleting ? data.categories.find(category => category.id !== deleting.id && (category.id === 'category-other' || category.name === '其他')) || data.categories.find(category => category.id !== deleting.id) : undefined;

  return <div className="organize-page settings-page"><div className="organize-heading"><div><p className="organize-eyebrow">把食譜庫變成你的模樣</p><h1>設定與備份</h1><p className="muted">管理分類、選擇外觀，好好保存每一份食譜。</p></div></div>
    <LocalFolderSettings/>
    <section className="settings-section"><div className="settings-section-heading"><Sun size={21}/><div><h2>外觀</h2><p>選擇最舒服的閱讀方式。</p></div></div><div className="theme-options">{themes.map(theme => <button key={theme.id} className={`theme-option ${data.theme === theme.id ? 'selected' : ''}`} aria-pressed={data.theme === theme.id} onClick={() => update(draft => { draft.theme = theme.id; })}><theme.icon size={23}/><strong>{theme.name}</strong><span>{theme.id === 'light' ? '溫暖明亮，像陽光下的廚房' : theme.id === 'dark' ? '柔和低光，適合夜晚使用' : '配合你的裝置設定'}</span></button>)}</div></section>
    <section className="settings-section"><div className="settings-section-heading"><Archive size={21}/><div><h2>食譜分類</h2><p>{data.categories.length} 個分類 · 刪除分類時會保留食譜。</p></div></div><div className="category-manager">{data.categories.map(category => <div className="category-manager-row" key={category.id}><span className="category-emoji">{category.emoji}</span><strong>{category.name}</strong><span className="category-recipe-count">{data.recipes.filter(recipe => recipe.categoryId === category.id).length} 款</span><button className="icon-button" aria-label={`修改${category.name}分類`} onClick={() => setEditing({ ...category })}><Pencil size={16}/></button><button className="icon-button" aria-label={`刪除${category.name}分類`} title={data.categories.length === 1 ? '至少需保留一個分類' : `刪除${category.name}`} disabled={data.categories.length <= 1} onClick={() => setDeleting(category)}><Trash2 size={16}/></button></div>)}</div><form className="category-add-form" onSubmit={event => { event.preventDefault(); addCategory(); }}><input className="field" aria-label="新分類名稱" placeholder="新增分類，例如：一人料理" value={newName} maxLength={80} onChange={event => setNewName(event.target.value)}/><button className="button secondary" disabled={!newName.trim()}><Plus size={17}/>新增分類</button></form></section>
    <section className="settings-section"><div className="settings-section-heading"><ShieldCheck size={22}/><div><h2>資料備份</h2><p>匯出完整 JSON 備份，換裝置也能帶上自己的食譜。</p></div></div><div className="backup-summary"><div><strong>{data.recipes.length}</strong><span>款食譜</span></div><div><strong>{data.categories.length}</strong><span>個分類</span></div><div><strong>{data.meals.length}</strong><span>個餐點計劃</span></div><div><strong>{data.shopping.length}</strong><span>項購物食材</span></div></div><div className="backup-buttons"><button className="button primary" onClick={safeExport}><Download size={18}/>匯出 JSON 備份</button><button className="button secondary" disabled={reading} onClick={() => fileInput.current?.click()}><Upload size={18}/>{reading ? '檢查檔案中…' : '匯入 JSON 備份'}</button><input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="選擇食譜備份檔案" onChange={event => { const file = event.target.files?.[0]; if (file) void readBackup(file); }}/></div>{error && <p className="organize-error" role="alert">{error}</p>}<div className="local-storage-notice"><ShieldCheck size={22}/><div><strong>{localFolder.name ? '已選擇本機食譜資料夾' : '目前只存於這個瀏覽器'}</strong><p>{localFolder.name ? '日常修改會自動寫入所選資料夾，請確認顯示「已儲存」才關閉。JSON 匯出可用於分享或另存一份；也可匯入 cookbook.json 或 cookbook.previous.json。' : '可在上方選擇本機資料夾，讓食譜直接存成電腦檔案。未啟用時，清除瀏覽器資料可能會失去食譜，請保留備份。'}</p></div></div></section>
    <section className="settings-section future-note"><h2>關於 AI 與雲端同步</h2><p>目前的文字及網頁內容匯入在本機處理，無需 API Key 或費用。圖片辨識、翻譯、AI 整理及 Supabase 同步尚未連接；啟用前需要設定第三方服務，並確認資料傳送方式及相關費用。</p></section>
    {editing && <Modal title="修改分類" onClose={() => setEditing(null)} className="compact-modal"><form onSubmit={event => { event.preventDefault(); saveCategory(); }}><label className="form-label">分類名稱<input className="field" value={editing.name} maxLength={80} required onChange={event => setEditing({ ...editing, name: event.target.value })} autoFocus/></label><label className="form-label">圖示（Emoji）<input className="field" value={editing.emoji} maxLength={12} onChange={event => setEditing({ ...editing, emoji: event.target.value })}/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={!editing.name.trim()}>儲存分類</button></div></form></Modal>}
    {deleting && <ConfirmDialog title={`刪除「${deleting.name}」？`} description={`這個分類的 ${data.recipes.filter(recipe => recipe.categoryId === deleting.id).length} 款食譜會移至「${replacement?.name || '其他'}」，食譜內容及收藏不會刪除。`} onClose={() => setDeleting(null)} onConfirm={deleteCategory}/>}
    {backup && <Modal title="確認還原備份" onClose={() => setBackup(null)} className="compact-modal"><p className="muted">已檢查「{backupName}」的格式及資料關聯。</p><div className="backup-preview"><strong>{backup.recipes.length} 款食譜</strong><span>{backup.categories.length} 個分類 · {backup.shopping.length} 項食材 · {backup.meals.length} 個餐點</span><ul>{backup.recipes.slice(0, 5).map(recipe => <li key={recipe.id}>{recipe.title}</li>)}</ul>{backup.recipes.length > 5 && <span>及另外 {backup.recipes.length - 5} 款食譜</span>}</div><p className="organize-warning">還原會取代目前的全部食譜、購物清單、煮食計劃和設定。建議先匯出目前資料作備份。</p>{error && <p className="organize-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={safeExport}>先匯出目前資料</button><button className="button danger" onClick={() => { if (replaceData(backup)) { setBackup(null); notify('備份已還原'); } }}>確認取代及還原</button></div></Modal>}
  </div>;
}
