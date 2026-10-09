import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChefHat, ChevronRight, Clock3, Heart, Home, Leaf, Menu, Moon, Plus, Search, Settings as SettingsIcon, ShieldCheck, ShoppingBasket, Shuffle, SlidersHorizontal, Sparkles, Sun, Users, X } from 'lucide-react';
import { useCookbook } from './store';
import type { Page, Recipe } from './types';
import RecipeDetail from './components/RecipeDetail';
import RecipeEditor from './components/RecipeEditor';
import CookingMode from './components/CookingMode';
import ShoppingList from './components/ShoppingList';
import MealPlanner from './components/MealPlanner';
import Settings from './components/Settings';
import ImportRecipe from './components/ImportRecipe';
import { ConfirmDialog } from './components/ui';

const navigation = [
  { id: 'home' as Page, label: '首頁', icon: Home },
  { id: 'recipes' as Page, label: '全部食譜', icon: BookOpen },
  { id: 'favorites' as Page, label: '我的最愛', icon: Heart },
  { id: 'planner' as Page, label: '每週計劃', icon: CalendarDays },
  { id: 'shopping' as Page, label: '購物清單', icon: ShoppingBasket },
];
const pageNames: Record<Page, string> = { home: '首頁', recipes: '全部食譜', favorites: '我的最愛', planner: '每週煮食計劃', shopping: '購物清單', settings: '設定與備份' };

export function RecipeCard({ recipe, onOpen }: { recipe: Recipe; onOpen: (id: string) => void }) {
  const { data, update, notify } = useCookbook();
  const category = data.categories.find(c => c.id === recipe.categoryId);
  return <article className="recipe-card">
    <button className="card-image-button" onClick={() => onOpen(recipe.id)} aria-label={`查看${recipe.title}`}><img src={recipe.image || '/images/fallback.svg'} alt={`${recipe.title}${recipe.demo ? '（示意圖片）' : ''}`} loading="lazy" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/fallback.svg'; }} /><span className="card-category">{category?.name || '其他'}</span></button>
    <button className={`favorite-button ${recipe.favorite ? 'is-favorite' : ''}`} aria-label={`${recipe.favorite ? '取消收藏' : '收藏'}${recipe.title}`} aria-pressed={recipe.favorite} onClick={() => { update(draft => { const found = draft.recipes.find(r => r.id === recipe.id); if (found) found.favorite = !found.favorite; }); notify(recipe.favorite ? '已取消收藏' : '已加入我的最愛'); }}><Heart size={18} fill={recipe.favorite ? 'currentColor' : 'none'}/></button>
    <div className="card-body"><button className="card-title" onClick={() => onOpen(recipe.id)}><h3>{recipe.title}</h3><ArrowUpRight size={18}/></button><p className="card-description">{recipe.description}</p><div className="card-meta"><span><Clock3 size={14}/>{recipe.prepMinutes + recipe.cookMinutes} 分鐘</span><span><Users size={14}/>{recipe.servings} 人份</span><span><ChefHat size={14}/>{recipe.difficulty}</span></div></div>
  </article>;
}

export default function App() {
  const { data, loading, storageReady, saveError, conflict, reloadLatest, update, notify, toast, retrySave } = useCookbook();
  const [page, setPage] = useState<Page>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Recipe | true | null>(null);
  const [cookingId, setCookingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [tool, setTool] = useState('all');
  const [time, setTime] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [sort, setSort] = useState('recent');
  const [suggestionId, setSuggestionId] = useState('');
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash.startsWith('recipe/')) { try { setDetailId(decodeURIComponent(hash.slice(7))); } catch { setDetailId(null); } }
      else { setDetailId(null); if (hash in pageNames) setPage(hash as Page); }
      setMenuOpen(false);
    };
    readHash(); window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { setSystemDark(media.matches); document.documentElement.dataset.theme = data.theme === 'system' ? (media.matches ? 'dark' : 'light') : data.theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data.theme]);

  function navigate(next: Page, reset = false) {
    if (reset) resetFilters();
    setPage(next); setDetailId(null); setMenuOpen(false); window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openRecipe(id: string) { setDetailId(id); window.location.hash = `recipe/${encodeURIComponent(id)}`; }
  function closeRecipe() { setDetailId(null); window.location.hash = page; }
  function resetFilters() { setQuery(''); setCategory('all'); setTool('all'); setTime('all'); setDifficulty('all'); setFavoriteOnly(false); }
  function surprise() {
    if (!data.recipes.length) { setEditor(true); return; }
    const options = data.recipes.filter(r => r.id !== suggestionId);
    const recipe = (options.length ? options : data.recipes)[Math.floor(Math.random() * (options.length || data.recipes.length))];
    setSuggestionId(recipe.id);
  }
  const favoriteCount = data.recipes.filter(r => r.favorite).length;
  const activeFilterCount = [category !== 'all', tool !== 'all', time !== 'all', difficulty !== 'all', favoriteOnly].filter(Boolean).length;
  const hasSearch = Boolean(query.trim()) || activeFilterCount > 0;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return data.recipes.filter(recipe => {
      const haystack = [recipe.title, recipe.description, ...recipe.tags, ...recipe.ingredients.map(i => i.name)].join(' ').toLocaleLowerCase();
      const minutes = recipe.prepMinutes + recipe.cookMinutes;
      return (!needle || haystack.includes(needle)) && (category === 'all' || recipe.categoryId === category) && (tool === 'all' || recipe.tool === tool) && (time === 'all' || (time === '60+' ? minutes > 60 : minutes <= Number(time))) && (difficulty === 'all' || recipe.difficulty === difficulty) && (!(favoriteOnly || page === 'favorites') || recipe.favorite);
    }).sort((a, b) => sort === 'quick' ? a.prepMinutes + a.cookMinutes - b.prepMinutes - b.cookMinutes : sort === 'name' ? a.title.localeCompare(b.title, 'zh-Hant') : b.createdAt.localeCompare(a.createdAt));
  }, [data.recipes, query, category, tool, time, difficulty, favoriteOnly, page, sort]);
  const suggested = data.recipes.find(r => r.id === suggestionId) || data.recipes[0];
  const tools = [...new Set(data.recipes.map(r => r.tool).filter(Boolean))];
  const themeDark = data.theme === 'dark' || (data.theme === 'system' && systemDark);
  const recipePages = page === 'home' || page === 'recipes' || page === 'favorites';

  if (loading) return <div className="loading-screen"><div className="brand-icon"><BookOpen size={28}/></div><h1>我的食譜庫</h1><p>正在打開你的食譜書…</p><div className="loading-dots" /></div>;
  if (!storageReady) return <div className="loading-screen"><ShieldCheck size={40}/><h1>暫時無法讀取食譜</h1><p>{saveError || '請確認瀏覽器允許本機資料儲存。'}</p><button className="button primary" onClick={retrySave}>重新讀取</button><p className="muted">為保障已有資料，暫停所有寫入操作。</p></div>;
  return <div className="app-layout">
    {menuOpen && <button className="sidebar-backdrop" aria-label="關閉選單" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
      <button className="brand" onClick={() => navigate('home', true)} aria-label="我的食譜庫首頁"><span className="brand-icon"><BookOpen size={24}/></span><span><strong>我的食譜庫</strong><small>日常滋味，好好收藏</small></span></button>
      <div className="sidebar-label">我的料理空間</div>
      <nav className="desktop-nav" aria-label="主要導覽">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id, true)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19}/><span>{item.label}</span>{item.id === 'recipes' && <span className="nav-count">{data.recipes.length}</span>}{item.id === 'favorites' && favoriteCount > 0 && <span className="nav-count">{favoriteCount}</span>}</button>)}</nav>
      <div className="sidebar-inspiration"><div className="inspiration-icon"><Leaf size={21}/></div><p>今天，想煮點甚麼？</p><span>讓食譜庫帶來一點靈感。</span><button onClick={() => { if (data.recipes.length) openRecipe(data.recipes[Math.floor(Math.random() * data.recipes.length)].id); else setEditor(true); }}><Shuffle size={15}/> 隨機選一道 <ArrowRight size={15}/></button></div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><SettingsIcon size={19}/>設定與備份</button><div className="local-status"><span className="status-dot"/><span>私人食譜 · 本機儲存</span><ShieldCheck size={14}/></div></div>
    </aside>

    <div className="main-layout">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="開啟選單" onClick={() => setMenuOpen(true)}><Menu size={21}/></button><span className="desktop-crumb">我的料理空間</span><ChevronRight size={14} className="desktop-crumb"/><strong>{page === 'home' ? <><span className="desktop-home-label">首頁</span><span className="mobile-home-label">我的食譜庫</span></> : pageNames[page]}</strong></div><div className="topbar-actions"><button className="icon-button theme-button" aria-label={themeDark ? '切換淺色模式' : '切換深色模式'} onClick={() => update(draft => { draft.theme = themeDark ? 'light' : 'dark'; })}>{themeDark ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button mobile-settings" aria-label="設定與備份" onClick={() => navigate('settings')}><SettingsIcon size={19}/></button><button className="button secondary import-button" aria-label="匯入食譜" onClick={() => setImportOpen(true)}><ArrowDownToLine size={16}/><span>匯入食譜</span></button><button className="button primary add-recipe-button" aria-label="新增食譜" onClick={() => setEditor(true)}><Plus size={18}/><span>新增食譜</span></button></div></header>
      {saveError && <div className="save-error" role="alert"><span>{saveError} 請勿關閉頁面，先匯出備份。</span>{conflict ? <button onClick={() => setReloadConfirm(true)}>重新讀取最新資料</button> : <button onClick={retrySave}>重試儲存</button>}<button onClick={() => navigate('settings')}>前往備份</button></div>}
      <main className="main-content" id="main-content">
        {page === 'home' && !hasSearch && <>
          <section className="welcome-section"><div><span className="eyebrow"><span className="tiny-leaf">✦</span> 把喜歡的味道，留在身邊</span><h1>每一餐，都有家的味道<span>。</span></h1><p>你的私人食譜書，收藏靈感，也收藏生活。</p></div><div className="welcome-date"><Leaf size={17}/><span>好好煮 · 好好吃</span></div></section>
          <section className="hero-panel"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14}/> 今日煮食靈感</span><h2>不知道煮甚麼？<br/>讓一道好菜，<br/><em>點亮你的日常。</em></h2><p>從熟悉的家常菜開始，<br/>為自己和喜歡的人，好好做一餐。</p><button className="button primary" onClick={() => suggested ? openRecipe(suggested.id) : setEditor(true)}>{suggested ? '看看今日推薦' : '加入第一道食譜'}<ArrowRight size={17}/></button><div className="hero-stats"><div><strong>{data.recipes.length.toString().padStart(2, '0')}</strong><span>收藏食譜</span></div><span className="stat-divider"/><div><strong>{data.categories.length.toString().padStart(2, '0')}</strong><span>料理分類</span></div><span className="stat-divider"/><div><strong>{favoriteCount.toString().padStart(2, '0')}</strong><span>心頭好</span></div></div></div><div className="hero-image"><img src={suggested?.image || '/images/black-pepper-chicken.jpg'} alt={suggested ? `${suggested.title}（示意圖片）` : '家常料理示意圖片'} fetchPriority="high"/><span className="hero-image-grain"/><button className="hero-shuffle" onClick={surprise} aria-label="換一道推薦食譜"><Shuffle size={17}/>換一道</button>{suggested && <button className="hero-feature-caption" onClick={() => openRecipe(suggested.id)}><div><span>今天的推薦</span><h3>{suggested.title}</h3><p><Clock3 size={14}/>{suggested.prepMinutes + suggested.cookMinutes} 分鐘 <span>·</span> {suggested.difficulty} <span>·</span> {suggested.servings} 人份</p></div><span className="feature-arrow"><ArrowUpRight size={21}/></span></button>}<span className="hero-decoration">一點煙火氣，一點小幸福</span></div></section>
        </>}
        {(page === 'recipes' || page === 'favorites') && <section className="page-intro"><span className="eyebrow">{page === 'favorites' ? '每一次心動，都值得留住' : '你的美味收藏，慢慢累積'}</span><h1>{page === 'recipes' ? '全部食譜' : '我的最愛'}<span className="heading-count">{page === 'recipes' ? data.recipes.length : favoriteCount}</span></h1><p>{page === 'recipes' ? '從一日三餐到偶爾的小確幸，找到你想煮的那一道。' : '把最喜歡的味道，放在最容易找到的地方。'}</p></section>}
        {recipePages && <section className="discovery-section" aria-label="搜尋及篩選食譜"><div className="search-row"><div className="search-input"><Search size={20}/><input aria-label="搜尋食譜、食材或標籤" placeholder="今天想煮甚麼？搜尋食譜、食材或標籤…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" onClick={() => setQuery('')} aria-label="清除搜尋"><X size={17}/></button>}<span className="search-short-label">搜尋美味</span></div><button className={`button filter-toggle ${filtersOpen ? 'selected' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}><SlidersHorizontal size={17}/><span>篩選</span>{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</button></div>
          {filtersOpen && <div className="filter-panel"><label>烹調工具<select value={tool} onChange={e => setTool(e.target.value)}><option value="all">所有工具</option>{tools.map(t => <option key={t}>{t}</option>)}</select></label><label>總時間<select value={time} onChange={e => setTime(e.target.value)}><option value="all">不限時間</option><option value="15">15 分鐘內</option><option value="30">30 分鐘內</option><option value="60">60 分鐘內</option><option value="60+">超過 60 分鐘</option></select></label><label>難度<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="all">所有難度</option><option>簡單</option><option>適中</option><option>挑戰</option></select></label><label className="checkbox-label"><input type="checkbox" checked={favoriteOnly || page === 'favorites'} disabled={page === 'favorites'} onChange={e => setFavoriteOnly(e.target.checked)}/>只看我的最愛</label><button className="text-button" onClick={resetFilters}>重設篩選</button></div>}
          <div className={`category-list ${categoriesOpen ? 'expanded' : ''}`}><button className={`category-chip ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}><BookOpen size={15}/>全部食譜</button>{(categoriesOpen ? data.categories : data.categories.slice(0, 6)).map(item => <button key={item.id} className={`category-chip ${category === item.id ? 'active' : ''}`} onClick={() => setCategory(item.id)}><span>{item.emoji}</span>{item.name}</button>)}<button className="category-chip more-categories" onClick={() => setCategoriesOpen(!categoriesOpen)} aria-expanded={categoriesOpen}>{categoriesOpen ? '收起分類' : '更多分類'}<ChevronRight size={14} style={{transform:categoriesOpen?'rotate(-90deg)':'rotate(90deg)'}}/></button></div>
        </section>}
        {recipePages && <section className="recipe-section"><div className="section-heading"><div className="section-title-group"><span className="section-title-mark"/><h2>{page === 'home' && !hasSearch ? '最近新增' : hasSearch ? '搜尋結果' : pageNames[page]}</h2><span className="result-count">{filtered.length} 道食譜</span></div>{page === 'home' && !hasSearch ? <button className="text-button" onClick={() => navigate('recipes', true)}>查看全部<ArrowRight size={15}/></button> : <label className="sort-label">排序<select aria-label="食譜排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近新增</option><option value="quick">烹調時間最短</option><option value="name">食譜名稱</option></select></label>}</div>
          {filtered.length ? <div className="recipe-grid">{(page === 'home' && !hasSearch ? filtered.slice(0, 6) : filtered).map(recipe => <RecipeCard key={recipe.id} recipe={recipe} onOpen={openRecipe}/>)}</div> : <div className="empty-state"><div className="empty-state-icon">{page === 'favorites' ? <Heart size={29}/> : <Search size={29}/>}</div><h3>{hasSearch ? '暫時找不到這道味道' : page === 'favorites' ? '收藏你的第一道心頭好' : '你的食譜書，由這一頁開始'}</h3><p>{hasSearch ? '試試其他食材或關鍵字，或者放寬篩選條件。' : page === 'favorites' ? '按下食譜上的愛心，喜歡的菜就會出現在這裏。' : '加入常煮的拿手菜，讓日常多一點靈感。'}</p><button className="button primary" onClick={() => hasSearch ? resetFilters() : page === 'favorites' ? navigate('recipes', true) : setEditor(true)}>{hasSearch ? '清除所有篩選' : page === 'favorites' ? '探索食譜' : '新增第一道食譜'}</button></div>}
        </section>}
        {page === 'home' && !hasSearch && <><section className="favorites-home recipe-section"><div className="section-heading"><div className="section-title-group"><Heart size={19} className="orange-icon"/><h2>我的心頭好</h2><span className="result-count">常煮，也常想念</span></div><button className="text-button" onClick={() => navigate('favorites', true)}>所有最愛<ArrowRight size={15}/></button></div>{favoriteCount ? <div className="recipe-grid">{data.recipes.filter(r => r.favorite).slice(0, 3).map(r => <RecipeCard recipe={r} key={r.id} onOpen={openRecipe}/>)}</div> : <div className="favorite-prompt"><Heart size={23}/><p>喜歡一道菜，就按下愛心。把想再煮一次的滋味收藏起來。</p><button className="text-button" onClick={() => navigate('recipes', true)}>找找心頭好<ArrowRight size={15}/></button></div>}</section><section className="planner-banner"><div className="planner-banner-icon"><CalendarDays size={28}/></div><div><h3>好好吃飯，從安排這一週開始。</h3><p>把喜歡的食譜放進每週計劃，順手準備購物清單。</p></div><button className="button secondary" onClick={() => navigate('planner')}>安排我的一週<ArrowRight size={16}/></button></section></>}
        {page === 'shopping' && <ShoppingList/>}
        {page === 'planner' && <MealPlanner onOpenRecipe={openRecipe}/>}
        {page === 'settings' && <Settings/>}
        <footer className="app-footer"><div><BookOpen size={16}/><span>我的食譜庫 <span className="footer-dot">·</span> 讓每一道家常，都值得收藏</span></div><span>資料只留在此瀏覽器 · 記得定期備份</span></footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="手機主要導覽">{navigation.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id, true)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={21}/><span>{item.label}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><span><Check size={15}/></span>{toast}</div>}
    {detailId && !editor && !cookingId && <RecipeDetail key={detailId} recipeId={detailId} onClose={closeRecipe} onEdit={recipe => setEditor(recipe)} onCook={recipe => setCookingId(recipe.id)}/>}
    {editor && <RecipeEditor recipe={editor === true ? undefined : editor} onClose={() => setEditor(null)} onSaved={id => { setEditor(null); openRecipe(id); }}/>}
    {cookingId && <CookingMode recipeId={cookingId} onClose={() => setCookingId(null)}/>}
    {importOpen && <ImportRecipe onClose={() => setImportOpen(false)} onReview={recipe => { setImportOpen(false); setEditor(recipe); notify('草稿已整理，請確認食材份量及步驟後儲存'); }}/>}
    {reloadConfirm && <ConfirmDialog title="重新讀取最新資料？" description="這個分頁尚未儲存的修改將被放棄，並載入另一個分頁已儲存的最新資料。請先到設定匯出目前修改作備份。" confirmLabel="確認重新讀取" onClose={() => setReloadConfirm(false)} onConfirm={() => { setEditor(null); setCookingId(null); setImportOpen(false); navigate('settings'); reloadLatest(); }}/>}
  </div>;
}
