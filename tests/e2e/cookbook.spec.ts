import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Every test receives a fresh browser context, including a fresh IndexedDB.
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await use(errors);
    expect(errors, 'No browser runtime or console errors').toEqual([]);
  }, { auto: true }],
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '每一餐，都有家的味道。' })).toBeVisible();
}

async function nav(page: Page, name: string, mobile: boolean) {
  if (name === '設定與備份') {
    if (mobile) await page.locator('.mobile-settings').click();
    else await page.locator('.sidebar-bottom').getByRole('button', { name, exact: true }).click();
  } else {
    await page.locator(mobile ? '.bottom-nav' : '.desktop-nav').getByRole('button', { name }).click();
  }
}

async function search(page: Page, text: string) {
  await page.getByRole('textbox', { name: '搜尋食譜、食材或標籤' }).fill(text);
}

async function openRecipe(page: Page, title: string) {
  await search(page, title);
  await page.getByRole('button', { name: `查看${title}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '食譜詳情' }).getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function noOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.document, `${label}: document fits viewport`).toBeLessThanOrEqual(dimensions.viewport + 1);
  const modal = page.getByRole('dialog');
  if (await modal.count()) {
    const bounds = await modal.last().boundingBox();
    expect(bounds, `${label}: modal has bounds`).not.toBeNull();
    expect(bounds!.x, `${label}: modal left`).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width, `${label}: modal right`).toBeLessThanOrEqual(dimensions.viewport + 1);
    const content = await modal.last().evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(content.scroll, `${label}: modal content fits`).toBeLessThanOrEqual(content.width + 1);
  }
}

async function stored(page: Page): Promise<any> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('my-recipe-cookbook', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app-data', 'readonly');
      const read = transaction.objectStore('app-data').get('cookbook');
      read.onsuccess = () => resolve(read.result?.data ?? read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }));
}

async function createRecipe(page: Page, title = '測試香草雞肉') {
  await page.getByRole('button', { name: '新增食譜', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增食譜', exact: true });
  await editor.getByLabel('食譜名稱').fill(title);
  await editor.getByLabel('簡短介紹').fill('一款用來驗證日常食譜新增、修改及保存流程的快手雞肉。');
  await editor.getByLabel('料理分類').selectOption('category-hong-kong');
  await editor.getByLabel('標籤', { exact: true }).fill('測試、快手');
  await editor.getByLabel('準備時間（分鐘）').fill('2');
  await editor.getByLabel('烹調時間（分鐘）').fill('8');
  await editor.getByLabel('烹調工具', { exact: true }).fill('平底鑊');
  await editor.getByLabel('食材 1 名稱', { exact: true }).fill('測試菇');
  await editor.getByLabel('食材 1 份量', { exact: true }).fill('200');
  await editor.getByRole('button', { name: '新增食材', exact: true }).click();
  await editor.getByLabel('食材 2 名稱', { exact: true }).fill('海鹽');
  await editor.getByLabel('食材 2 份量', { exact: true }).fill('1');
  await editor.getByLabel('食材 2 單位', { exact: true }).fill('茶匙');
  await editor.locator('.editor-ingredient').nth(1).getByRole('checkbox', { name: '調味料', exact: true }).check();
  await editor.getByRole('textbox', { name: '第 1 步說明', exact: true }).fill('印乾食材，加海鹽拌勻，準備好平底鑊。');
  await editor.getByRole('button', { name: '新增步驟', exact: true }).click();
  await editor.getByRole('textbox', { name: '第 2 步說明', exact: true }).fill('中火煮 8 分鐘，確認雞肉中心達 75°C 後上碟。');
  await editor.getByRole('button', { name: '第 2 步向上移', exact: true }).click();
  await expect(editor.locator('.editor-step').first().getByRole('textbox')).toHaveValue('中火煮 8 分鐘，確認雞肉中心達 75°C 後上碟。');
  await editor.getByRole('button', { name: '第 1 步向下移', exact: true }).click();
  const image = { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
  await editor.locator('.editor-cover input[type="file"]').setInputFiles(image);
  await expect(editor.getByAltText('食譜封面預覽')).toBeVisible();
  await editor.locator('.editor-step').first().locator('input[type="file"]').setInputFiles(image);
  await expect(editor.getByAltText('第 1 步圖片預覽')).toBeVisible();
  await noOverflow(page, 'filled recipe editor');
  await editor.getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '食譜詳情' }).getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).recipes.some((recipe: any) => recipe.title === title)).toBe(true);
}

test('dashboard, all screens, responsive layout and theme persist', async ({ page, isMobile }, testInfo) => {
  await ready(page);
  const lightBackground = await page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(page.locator('.hero-stats')).toContainText('06');
  await expect(page.locator('.recipe-section').first().locator('.recipe-card')).toHaveCount(6);
  await noOverflow(page, 'dashboard');
  await page.screenshot({ path: `/tmp/cookbook-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '新增食譜', exact: true }).click();
  await noOverflow(page, 'empty editor');
  await page.getByRole('dialog').getByRole('button', { name: '關閉視窗' }).click();
  await openRecipe(page, '薑蔥雞腿肉');
  await noOverflow(page, 'recipe detail');
  await page.getByRole('dialog').getByRole('button', { name: '關閉視窗' }).click();
  for (const screen of ['全部食譜', '我的最愛', '每週計劃', '購物清單', '設定與備份']) {
    await nav(page, screen, isMobile);
    await noOverflow(page, screen);
  }
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBackground = await page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  expect(darkBackground).toBe('rgb(25, 31, 28)');
  await expect.poll(async () => (await stored(page)).theme).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(darkBackground);
  await noOverflow(page, 'dark settings');
});

test('recipe create, ingredient search, combined filters, favorite, edit, duplicate and confirmed delete persist', async ({ page, isMobile }) => {
  await ready(page);
  await createRecipe(page);
  const detail = page.getByRole('dialog', { name: '食譜詳情' });
  await detail.getByRole('button', { name: '加入收藏', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.find((recipe: any) => recipe.title === '測試香草雞肉')?.favorite).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '關閉視窗' }).click();
  await search(page, '測試菇');
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '測試香草雞肉', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '篩選', exact: true }).click();
  await page.getByRole('combobox', { name: '烹調工具', exact: true }).selectOption('平底鑊');
  await page.getByRole('combobox', { name: '總時間', exact: true }).selectOption('15');
  await page.getByRole('combobox', { name: '難度', exact: true }).selectOption('簡單');
  await page.getByRole('checkbox', { name: '只看我的最愛', exact: true }).check();
  await page.getByRole('button', { name: '港式料理', exact: false }).click();
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await noOverflow(page, 'combined recipe filters');
  await page.getByRole('combobox', { name: '總時間', exact: true }).selectOption('60+');
  await expect(page.locator('.recipe-card')).toHaveCount(0);
  await page.getByRole('button', { name: '重設篩選', exact: true }).click();
  await openRecipe(page, '測試香草雞肉');
  await page.getByRole('dialog').getByRole('button', { name: '編輯', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '編輯食譜', exact: true });
  await editor.getByLabel('食譜名稱').fill('測試香草雞肉改版');
  await editor.getByRole('button', { name: '新增食材', exact: true }).click();
  await editor.getByRole('button', { name: '刪除食材 3', exact: true }).click();
  await editor.getByRole('button', { name: '新增步驟', exact: true }).click();
  await editor.getByRole('button', { name: '刪除第 3 步', exact: true }).click();
  await editor.getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.some((recipe: any) => recipe.title === '測試香草雞肉改版')).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: '複製', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('食譜名稱')).toHaveValue('測試香草雞肉改版（副本）');
  await page.getByRole('dialog').getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.length).toBe(8);
  await page.getByRole('dialog').getByRole('button', { name: '刪除食譜', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '刪除這款食譜？', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '刪除這款食譜？', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '食譜詳情' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '刪除食譜', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除這款食譜？', exact: true }).getByRole('button', { name: '確認刪除', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.length).toBe(7);
  await page.reload();
  await nav(page, '全部食譜', isMobile);
  await search(page, '副本');
  await expect(page.locator('.recipe-card')).toHaveCount(0);
  await nav(page, '我的最愛', isMobile);
  await search(page, '測試香草雞肉改版');
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await openRecipe(page, '測試香草雞肉改版');
  await page.getByRole('dialog').getByRole('button', { name: '編輯', exact: true }).click();
  await page.getByRole('dialog').getByLabel('食譜名稱').fill('未保存的名稱');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '放棄未儲存的修改？', exact: true }).getByRole('button', { name: '放棄修改', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '測試香草雞肉改版', exact: true })).toBeVisible();
});

test('scaled ingredients, checklists, notes, rating, cooking progress and countdown persist after reload', async ({ page }) => {
  await ready(page);
  await openRecipe(page, '薑蔥雞腿肉');
  let detail = page.getByRole('dialog', { name: '食譜詳情' });
  await detail.getByRole('button', { name: '增加一人份', exact: true }).click();
  await detail.getByRole('button', { name: '增加一人份', exact: true }).click();
  const chicken = detail.locator('.ingredient-row').filter({ hasText: '去骨雞腿肉' });
  await expect(chicken.locator('strong')).toHaveText('700 g');
  await expect(chicken.locator('.ingredient-amount small')).toHaveText('原份量：350 g');
  await chicken.getByRole('checkbox').check();
  await detail.getByRole('checkbox', { name: '已完成這一步', exact: true }).first().check();
  await detail.getByLabel('個人備註', { exact: true }).fill('下次少落鹽，薑絲可以再多一點。');
  await detail.getByRole('button', { name: '儲存筆記', exact: true }).click();
  await detail.getByRole('button', { name: '評分 4 星', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.find((recipe: any) => recipe.id === 'demo-ginger-chicken')?.rating).toBe(4);
  await page.reload();
  detail = page.getByRole('dialog', { name: '食譜詳情' });
  await expect(detail.locator('.ingredient-row').filter({ hasText: '去骨雞腿肉' }).getByRole('checkbox')).toBeChecked();
  await expect(detail.getByRole('checkbox', { name: '已完成這一步', exact: true }).first()).toBeChecked();
  await expect(detail.getByLabel('個人備註', { exact: true })).toHaveValue('下次少落鹽，薑絲可以再多一點。');
  await expect(detail.getByRole('button', { name: '評分 4 星', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await detail.getByRole('button', { name: '開始煮食', exact: true }).click();
  let cooking = page.getByRole('dialog', { name: '專心煮食' });
  await cooking.getByRole('button', { name: '查看食材', exact: true }).click();
  await noOverflow(page, 'cooking mode with ingredients');
  await cooking.getByRole('button', { name: '下一步', exact: true }).click();
  await cooking.getByRole('button', { name: '完成這一步', exact: true }).click();
  await cooking.getByLabel('自訂倒數', { exact: true }).fill('1');
  await cooking.getByRole('button', { name: '設定', exact: true }).click();
  await cooking.getByRole('button', { name: '開始', exact: true }).click();
  await expect.poll(async () => (await stored(page)).cooking['demo-ginger-chicken']?.timerEndsAt > Date.now()).toBe(true);
  await page.reload();
  await page.getByRole('dialog').getByRole('button', { name: '開始煮食', exact: true }).click();
  cooking = page.getByRole('dialog', { name: '專心煮食' });
  await expect(cooking.locator('.cooking-overall-progress')).toContainText('第 2 / 5 步');
  await expect(cooking.getByRole('button', { name: '暫停', exact: true })).toBeVisible();
  await expect(cooking.locator('.cooking-overall-progress')).toContainText('2 步已完成');
  await cooking.getByRole('button', { name: '暫停', exact: true }).click();
  await cooking.getByLabel('自訂倒數', { exact: true }).fill('0.1');
  await cooking.getByRole('button', { name: '設定', exact: true }).click();
  await cooking.getByRole('button', { name: '開始', exact: true }).click();
  await expect(cooking.getByText('時間到！記得檢查食物的熟度。')).toBeVisible({ timeout: 10_000 });
  await expect(cooking.getByRole('timer')).toHaveText('00:00');
});

test('detail step navigation selects the right timer and active countdown survives step changes', async ({ page }) => {
  await ready(page);
  await openRecipe(page, '薑蔥雞腿肉');
  let detail = page.getByRole('dialog', { name: '食譜詳情' });
  await detail.getByRole('button', { name: '下一步', exact: true }).click();
  await detail.getByRole('button', { name: '開始煮食', exact: true }).click();
  let cooking = page.getByRole('dialog', { name: '專心煮食' });
  await expect(cooking.locator('.cooking-overall-progress')).toContainText('第 2 / 5 步');
  await expect(cooking.getByRole('timer')).toHaveText('01:00');
  await cooking.getByRole('button', { name: '開始', exact: true }).click();
  await expect.poll(async () => (await stored(page)).cooking['demo-ginger-chicken']?.timerEndsAt !== null).toBe(true);
  const deadline = (await stored(page)).cooking['demo-ginger-chicken'].timerEndsAt;
  await cooking.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(cooking.locator('.cooking-overall-progress')).toContainText('第 3 / 5 步');
  await expect.poll(async () => (await stored(page)).cooking['demo-ginger-chicken']?.stepIndex).toBe(2);
  expect((await stored(page)).cooking['demo-ginger-chicken'].timerEndsAt).toBe(deadline);
  await cooking.getByRole('button', { name: '暫停', exact: true }).click();
  await cooking.getByRole('button', { name: '關閉視窗' }).click();
  detail = page.getByRole('dialog', { name: '食譜詳情' });
  await detail.getByRole('button', { name: '上一步', exact: true }).click();
  await detail.getByRole('button', { name: '開始煮食', exact: true }).click();
  cooking = page.getByRole('dialog', { name: '專心煮食' });
  await expect(cooking.getByRole('timer')).toHaveText('01:00');
  await cooking.getByRole('button', { name: '關閉視窗' }).click();
  await page.getByRole('dialog', { name: '食譜詳情' }).getByRole('button', { name: '查看第 1 步', exact: true }).click();
  await page.getByRole('dialog', { name: '食譜詳情' }).getByRole('button', { name: '開始煮食', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '專心煮食' }).getByRole('timer')).toHaveText('10:00');
});

test('shopping merges ingredients, quantities and purchased flags save, clipboard copies and weekly plan generates shopping', async ({ page, context, isMobile }) => {
  await ready(page);
  await openRecipe(page, '薑蔥雞腿肉');
  await page.getByRole('dialog').getByRole('button', { name: '加入購物清單', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '加入購物清單', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '關閉視窗' }).click();
  await nav(page, '購物清單', isMobile);
  await expect(page.getByLabel('去骨雞腿肉的數量')).toHaveValue('700');
  await page.getByLabel('去骨雞腿肉的數量').fill('750');
  await page.locator('.shopping-row').filter({ has: page.getByRole('checkbox', { name: '標記已購買去骨雞腿肉', exact: true }) }).locator('.shopping-checkbox').click();
  await expect.poll(async () => (await stored(page)).shopping.find((item: any) => item.name === '去骨雞腿肉')?.checked).toBe(true);
  await page.reload();
  await expect(page.getByLabel('去骨雞腿肉的數量')).toHaveValue('750');
  await expect(page.getByRole('checkbox', { name: '取消已購買去骨雞腿肉', exact: true })).toBeChecked();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '複製清單', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain('☑ 去骨雞腿肉 750 g');
  await page.getByRole('button', { name: '新增食材', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '新增食材', exact: true });
  await modal.getByLabel('食材名稱', { exact: true }).fill('測試水果');
  await modal.getByLabel('數量', { exact: true }).fill('3');
  await modal.getByLabel('單位', { exact: true }).fill('個');
  await modal.getByRole('button', { name: '儲存食材', exact: true }).click();
  await expect(page.getByLabel('測試水果的數量')).toHaveValue('3');
  await page.getByRole('button', { name: '編輯測試水果', exact: true }).click();
  modal = page.getByRole('dialog', { name: '編輯食材', exact: true });
  await modal.getByLabel('數量', { exact: true }).fill('4');
  await modal.getByRole('button', { name: '儲存食材', exact: true }).click();
  await expect(page.getByLabel('測試水果的數量')).toHaveValue('4');
  await page.getByRole('button', { name: '移除測試水果', exact: true }).click();
  await nav(page, '每週計劃', isMobile);
  for (const [slot, servings] of [['新增星期一午餐食譜', '2'], ['新增星期二晚餐食譜', '4']]) {
    await page.getByRole('button', { name: slot, exact: true }).click();
    const picker = page.getByRole('dialog');
    await picker.getByRole('button', { name: /薑蔥雞腿肉/ }).click();
    await picker.getByLabel('這餐需要幾人份？').fill(servings);
    await noOverflow(page, 'meal picker');
    await picker.getByRole('button', { name: '加入計劃', exact: true }).click();
  }
  await expect(page.locator('.planner-recipe')).toHaveCount(2);
  await expect.poll(async () => (await stored(page)).meals.length).toBe(2);
  await page.reload();
  await expect(page.locator('.planner-recipe')).toHaveCount(2);
  await page.getByRole('button', { name: '產生購物清單', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認取代並建立清單', exact: true }).click();
  await nav(page, '購物清單', isMobile);
  await expect(page.getByLabel('去骨雞腿肉的數量')).toHaveValue('1050');
  await expect(page.getByRole('checkbox', { name: '標記已購買去骨雞腿肉', exact: true })).not.toBeChecked();
  await noOverflow(page, 'populated shopping list');
  await nav(page, '每週計劃', isMobile);
  await page.getByRole('button', { name: '從星期一午餐移除薑蔥雞腿肉', exact: true }).click();
  await expect(page.locator('.planner-recipe')).toHaveCount(1);
  await noOverflow(page, 'populated planner');
});

test('category CRUD, backup export, safe restore confirmation and corrupt import preserves data', async ({ page, isMobile }) => {
  await ready(page);
  await nav(page, '設定與備份', isMobile);
  await page.getByRole('textbox', { name: '新分類名稱', exact: true }).fill('測試晚餐');
  await page.getByRole('button', { name: '新增分類', exact: true }).click();
  await page.getByRole('button', { name: '修改測試晚餐分類', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '修改分類', exact: true });
  await edit.getByLabel('分類名稱', { exact: true }).fill('測試快手');
  await edit.getByLabel('圖示（Emoji）', { exact: true }).fill('🥗');
  await edit.getByRole('button', { name: '儲存分類', exact: true }).click();
  await expect.poll(async () => (await stored(page)).categories.some((category: any) => category.name === '測試快手')).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '修改測試快手分類', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 JSON 備份', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const buffer = await readFile(path!);
  const exported = JSON.parse(buffer.toString());
  expect(JSON.stringify(exported)).toContain('測試快手');
  await page.getByRole('button', { name: '刪除測試快手分類', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認刪除', exact: true }).click();
  await expect(page.getByRole('button', { name: '修改測試快手分類', exact: true })).toHaveCount(0);
  await page.getByLabel('選擇食譜備份檔案', { exact: true }).setInputFiles({ name: 'cookbook-backup.json', mimeType: 'application/json', buffer });
  await expect(page.getByRole('dialog', { name: '確認還原備份', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '修改測試快手分類', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '確認取代及還原', exact: true }).click();
  await expect(page.getByRole('button', { name: '修改測試快手分類', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).categories.length).toBe(13);
  await page.reload();
  await expect(page.getByRole('button', { name: '修改測試快手分類', exact: true })).toBeVisible();
  await page.getByLabel('選擇食譜備份檔案', { exact: true }).setInputFiles({ name: 'corrupt.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"recipes":"broken"}') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await stored(page)).recipes).toHaveLength(6);
  expect((await stored(page)).categories).toHaveLength(13);
  await page.getByRole('button', { name: '刪除港式料理分類', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認刪除', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.find((recipe: any) => recipe.id === 'demo-black-pepper-chicken')?.categoryId).toBe('category-other');
  expect((await stored(page)).recipes).toHaveLength(6);
  await noOverflow(page, 'settings and backup error');
});

test('local text and structured web imports remain reviewable drafts until explicitly saved', async ({ page }) => {
  await ready(page);
  const text = '測試番茄炒蛋\n準備時間：5 分鐘\n烹調時間：10 分鐘\n份量：2 人份\n\n食材\n雞蛋 3 個\n番茄 2 個\n\n調味料\n鹽 適量\n\n做法\n1. 把雞蛋拌勻，番茄切件。\n2. 平底鑊中火煮 10 分鐘，最後調味。';
  await page.getByRole('button', { name: '匯入食譜', exact: true }).click();
  let importer = page.getByRole('dialog', { name: '匯入你的食譜', exact: true });
  await importer.getByRole('textbox', { name: '食譜文字', exact: true }).fill(text);
  await importer.getByLabel('來源網址（選填）').fill('https://example.com/recipe');
  await importer.getByRole('button', { name: '整理並檢閱食譜', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '編輯食譜', exact: true });
  await expect(editor.getByLabel('食譜名稱')).toHaveValue('測試番茄炒蛋');
  await expect(editor.getByLabel('食材 1 份量', { exact: true })).toHaveValue('3');
  await expect(editor.getByLabel('食材 2 份量', { exact: true })).toHaveValue('2');
  await expect(editor.getByLabel('食材 3 份量', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('準備時間（分鐘）')).toHaveValue('5');
  await expect(editor.getByLabel('烹調時間（分鐘）')).toHaveValue('10');
  await expect(editor.getByLabel('份量（人份）')).toHaveValue('2');
  expect((await stored(page)).recipes).toHaveLength(6);
  await noOverflow(page, 'text import review');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect((await stored(page)).recipes).toHaveLength(6);
  await page.getByRole('button', { name: '匯入食譜', exact: true }).click();
  importer = page.getByRole('dialog', { name: '匯入你的食譜', exact: true });
  await importer.getByRole('textbox', { name: '食譜文字', exact: true }).fill(text);
  await importer.getByLabel('來源網址（選填）').fill('https://example.com/recipe');
  await importer.getByRole('button', { name: '整理並檢閱食譜', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.length).toBe(7);
  await expect(page.getByRole('dialog').getByRole('link', { name: '查看原始來源', exact: true })).toHaveAttribute('href', 'https://example.com/recipe');
  await page.getByRole('dialog').getByRole('button', { name: '關閉視窗' }).click();
  await page.getByRole('button', { name: '匯入食譜', exact: true }).click();
  importer = page.getByRole('dialog', { name: '匯入你的食譜', exact: true });
  await importer.getByRole('button', { name: '網頁內容', exact: true }).click();
  await importer.getByRole('textbox', { name: '網頁 HTML / Recipe JSON-LD', exact: true }).fill(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: '測試網頁焗薯', recipeIngredient: ['薯仔 300 g', '鹽 適量'], recipeInstructions: [{ '@type': 'HowToStep', text: '把薯仔切件，以 180°C 焗 20 分鐘。' }], prepTime: 'PT5M', cookTime: 'PT20M', recipeYield: '2 人份' }));
  await importer.getByLabel('來源網址（選填）').fill('https://example.com/potatoes');
  await importer.getByRole('button', { name: '整理並檢閱食譜', exact: true }).click();
  editor = page.getByRole('dialog', { name: '編輯食譜', exact: true });
  await expect(editor.getByLabel('食譜名稱')).toHaveValue('測試網頁焗薯');
  await expect(editor.getByLabel('食材 1 份量', { exact: true })).toHaveValue('300');
  await expect(editor.getByRole('textbox', { name: '第 1 步說明', exact: true })).toHaveValue('把薯仔切件，以 180°C 焗 20 分鐘。');
  await expect(editor.getByLabel('烹調時間（分鐘）')).toHaveValue('20');
  expect((await stored(page)).recipes).toHaveLength(7);
  await editor.getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.length).toBe(8);
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '測試網頁焗薯', exact: true })).toBeVisible();
});

test('concurrent tabs detect stale saves, preserve committed favorites and explicitly reload before editing', async ({ page, context, browserErrors }) => {
  await ready(page);
  const other = await context.newPage();
  other.on('pageerror', error => browserErrors.push(error.message));
  other.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await ready(other);
  await page.getByRole('button', { name: '收藏日式照燒雞', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.find((recipe: any) => recipe.id === 'demo-teriyaki-chicken')?.favorite).toBe(true);
  await other.getByRole('button', { name: '切換深色模式', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('另一個分頁已更新食譜庫');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await stored(page)).theme).toBe('light');
  expect((await stored(page)).recipes.find((recipe: any) => recipe.id === 'demo-teriyaki-chicken').favorite).toBe(true);
  // Further local writes remain blocked until the user chooses to discard the stale draft.
  await other.getByRole('button', { name: '切換淺色模式', exact: true }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await stored(page)).theme).toBe('light');
  await noOverflow(other, 'concurrent edit warning');
  await other.getByRole('button', { name: '重新讀取最新資料', exact: true }).click();
  const confirmation = other.getByRole('dialog', { name: '重新讀取最新資料？', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '確認重新讀取', exact: true }).click();
  await expect(other.getByRole('heading', { name: '設定與備份', exact: true })).toBeVisible();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(other.getByRole('alert')).toHaveCount(0);
  await other.getByRole('button', { name: '切換深色模式', exact: true }).click();
  await expect.poll(async () => (await stored(other)).theme).toBe('dark');
  expect((await stored(other)).recipes.find((recipe: any) => recipe.id === 'demo-teriyaki-chicken').favorite).toBe(true);
  await other.close();
});

test('legacy IndexedDB migrates without losing recipes and malformed records are never replaced with demos', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '收藏日式照燒雞', exact: true }).click();
  await expect.poll(async () => (await stored(page)).recipes.find((recipe: any) => recipe.id === 'demo-teriyaki-chicken')?.favorite).toBe(true);
  const legacy = await stored(page);
  const writeRecord = async (value: unknown) => page.evaluate(async record => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('my-recipe-cookbook', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app-data', 'readwrite');
      transaction.objectStore('app-data').put(record, 'cookbook');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), value);
  await writeRecord(legacy);
  await page.reload();
  await expect(page.getByRole('button', { name: '取消收藏日式照燒雞', exact: true })).toBeVisible();
  expect((await stored(page)).recipes).toHaveLength(6);
  const corrupted = { revision: -1, data: legacy };
  await writeRecord(corrupted);
  await page.reload();
  await expect(page.getByRole('heading', { name: '暫時無法讀取食譜', exact: true })).toBeVisible();
  await expect(page.getByText('為保障已有資料，暫停所有寫入操作。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增食譜', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暫時無法讀取食譜', exact: true })).toBeVisible();
  // A broken database retains the original data instead of silently seeding examples.
  const record = await page.evaluate(async () => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open('my-recipe-cookbook', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app-data', 'readonly');
      const read = transaction.objectStore('app-data').get('cookbook');
      read.onsuccess = () => resolve(read.result);
      transaction.oncomplete = () => database.close();
    };
  }));
  expect(record).toEqual(corrupted);
});
