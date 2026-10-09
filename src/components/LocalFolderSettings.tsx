import { useState } from 'react';
import { CheckCircle2, FolderOpen, HardDrive, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useCookbook } from '../store';
import { ConfirmDialog, Modal } from './ui';
import '../organize.css';

function savedTime(value: string | null): string {
  if (!value) return '尚未儲存到資料夾';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '已儲存';
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).format(date);
}

export default function LocalFolderSettings() {
  const {
    data, saving, localFolder, pendingFolder, chooseLocalFolder, confirmLocalFolder,
    cancelLocalFolder, reconnectLocalFolder, returnToBrowserStorage,
  } = useCookbook();
  const [leavingFolder, setLeavingFolder] = useState(false);
  const busy = localFolder.busy;
  const connected = localFolder.status === 'ready';
  const reconnect = localFolder.status === 'permission' || (localFolder.status === 'error' && !!localFolder.name);
  const unsupported = localFolder.status === 'unsupported';
  const activeFolder = localFolder.name && localFolder.status !== 'browser' && !unsupported;

  return <section className="settings-section local-folder-section">
    <div className="settings-section-heading"><HardDrive size={22}/><div><h2>存到電腦資料夾</h2><p>選擇一次資料夾，之後修改食譜會自動儲存，毋須每次匯出。</p></div></div>

    {activeFolder ? <div className={`local-folder-status ${connected ? 'is-connected' : 'needs-attention'}`}>
      <div className="local-folder-symbol"><FolderOpen size={26}/></div>
      <div className="local-folder-status-copy"><strong>{localFolder.name}</strong>
        <span role="status" aria-live="polite">{busy || (connected && saving) ? <><LoaderCircle size={14} className="local-folder-spinner"/>{connected && saving ? '正在儲存…' : '正在連接資料夾…'}</> : connected ? <><CheckCircle2 size={14}/>已連接，修改後自動儲存</> : '等待連接資料夾'}</span>
        {localFolder.savedAt && <small>最後儲存：{savedTime(localFolder.savedAt)}</small>}
      </div>
    </div> : <div className="local-folder-intro"><FolderOpen size={27}/><div><strong>為食譜揀一個固定的位置</strong><p>例如在「文件」建立「我的食譜庫」資料夾。目前的 {data.recipes.length} 款食譜、上傳圖片、購物清單及煮食計劃都會一併搬過去。</p></div></div>}

    {reconnect && <p className="local-folder-guidance">請按「繼續使用此資料夾」，准許 App 讀取及儲存。重新開啟瀏覽器後，可能需要再准許一次。連接完成前，請留意儲存狀態。</p>}
    {unsupported && <p className="local-folder-guidance">這個瀏覽器未支援直接儲存到資料夾。請在電腦以 Google Chrome 或 Microsoft Edge 開啟食譜庫，再選擇本機資料夾。目前的瀏覽器儲存及匯出功能仍然可用。</p>}
    {localFolder.error && <p className="organize-error" role="alert">{localFolder.error}</p>}

    <div className="local-folder-actions">
      {reconnect && <button className="button primary" disabled={busy} onClick={() => { void reconnectLocalFolder(); }}><FolderOpen size={18}/>{busy ? '連接中…' : '繼續使用此資料夾'}</button>}
      {!unsupported && <button className={`button ${activeFolder ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => { void chooseLocalFolder(); }}><FolderOpen size={18}/>{activeFolder ? '選擇另一個資料夾' : '選擇本機資料夾'}</button>}
      {activeFolder && <button className="text-button" disabled={busy} onClick={() => setLeavingFolder(true)}>改回只存瀏覽器</button>}
    </div>

    <div className="local-storage-notice local-folder-notice"><ShieldCheck size={21}/><div><strong>資料保存在你電腦的實體檔案</strong><p>選好資料夾後，食譜及圖片會儲存在 <code>cookbook.json</code>，並在 <code>cookbook.previous.json</code> 自動保留上一份已儲存資料。清除瀏覽器資料不會刪除這些檔案；之後重新選擇同一個資料夾便可開啟。請保留整個資料夾，換電腦時亦可一併複製。</p></div></div>

    {pendingFolder && <Modal title={pendingFolder.existing ? '開啟資料夾內的食譜？' : '將食譜搬到這個資料夾？'} onClose={() => { if (!busy) cancelLocalFolder(); }} className="compact-modal">
      <p className="muted">已選擇「{pendingFolder.name}」。{pendingFolder.existing ? '找到已有的食譜檔案，請確認是否開啟。' : '這個資料夾未有食譜檔案，將建立新的 cookbook.json。'}</p>
      <div className="backup-preview"><strong>{pendingFolder.data.recipes.length} 款食譜</strong><span>{pendingFolder.data.categories.length} 個分類 · {pendingFolder.data.shopping.length} 項食材 · {pendingFolder.data.meals.length} 個餐點</span>
        {pendingFolder.updatedAt && <p className="local-folder-preview-date">檔案更新：{savedTime(pendingFolder.updatedAt)}</p>}
        {pendingFolder.data.recipes.length > 0 && <ul>{pendingFolder.data.recipes.slice(0, 5).map(recipe => <li key={recipe.id}>{recipe.title}</li>)}</ul>}
        {pendingFolder.data.recipes.length > 5 && <span>及另外 {pendingFolder.data.recipes.length - 5} 款食譜</span>}
      </div>
      <p className="organize-warning">{pendingFolder.existing ? '開啟後，目前顯示的食譜、圖片、購物清單、煮食計劃及設定會改為這個資料夾的內容。兩邊資料不會自動合併，請確認選中了所需資料夾。' : '會將目前全部資料及上傳圖片儲存到這個資料夾，之後每次修改都會自動儲存。'}</p>
      {localFolder.error && <p className="organize-error" role="alert">{localFolder.error}</p>}
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={cancelLocalFolder}>取消</button><button className="button primary" disabled={busy} onClick={() => { void confirmLocalFolder(); }}>{busy ? '處理中…' : pendingFolder.existing ? '開啟此資料夾的食譜' : '建立並搬到資料夾'}</button></div>
    </Modal>}
    {leavingFolder && <ConfirmDialog title="改回只存瀏覽器？" description="資料夾內的食譜檔案會保留。目前食譜會繼續存於這個瀏覽器，但之後的修改不會再自動寫入資料夾。" confirmLabel="確認改回瀏覽器" onClose={() => setLeavingFolder(false)} onConfirm={() => { void returnToBrowserStorage(); }}/>}
  </section>;
}
