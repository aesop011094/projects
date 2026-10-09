import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Chromium's managed policy prevents file:// navigation and automating the native
// OS folder picker is not supported. Replace only the picker with a real OPFS
// DirectoryHandle: native streams, handle cloning, hashing and locks still run.
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await use(errors);
    expect(errors, 'No browser runtime or console errors').toEqual([]);
  }, { auto: true }],
});

const directoryName = '電腦食譜庫';
const mainFile = 'cookbook.json';
const previousFile = 'cookbook.previous.json';

async function installPicker(context: BrowserContext) {
  await context.addInitScript(() => {
    const handlePrototype = FileSystemHandle.prototype as unknown as {
      queryPermission: (options: { mode: string }) => Promise<PermissionState>;
      requestPermission: (options: { mode: string }) => Promise<PermissionState>;
    };
    const originalQuery = handlePrototype.queryPermission;
    const originalRequest = handlePrototype.requestPermission;
    handlePrototype.queryPermission = async function (options) {
      if (localStorage.getItem('folder-test-permission') === 'denied') return 'denied';
      return originalQuery.call(this, options);
    };
    handlePrototype.requestPermission = async function (options) {
      if (localStorage.getItem('folder-test-request') === 'grant') {
        localStorage.removeItem('folder-test-permission');
        localStorage.removeItem('folder-test-write-failure');
        return 'granted';
      }
      if (localStorage.getItem('folder-test-permission') === 'denied') return 'denied';
      return originalRequest.call(this, options);
    };
    const originalWrite = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (localStorage.getItem('folder-test-write-failure') === 'denied') throw new DOMException('Permission revoked by test', 'NotAllowedError');
      return originalWrite.apply(this, args);
    };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'my-recipe-cookbook-folder-link' && localStorage.getItem('folder-test-registry') === 'fail') {
        throw new DOMException('Could not remember folder in test', 'QuotaExceededError');
      }
      return originalPut.apply(this, args);
    };
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        if (localStorage.getItem('folder-test-picker') === 'cancel') throw new DOMException('Picker cancelled by test', 'AbortError');
        return (await navigator.storage.getDirectory()).getDirectoryHandle(localStorage.getItem('folder-test-directory') || '電腦食譜庫', { create: true });
      },
    });
  });
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '每一餐，都有家的味道。' })).toBeVisible();
}

async function settings(page: Page, mobile: boolean) {
  if (await page.getByRole('heading', { name: '設定與備份', exact: true }).isVisible()) return;
  if (mobile) await page.locator('.mobile-settings').click();
  else await page.locator('.sidebar-bottom').getByRole('button', { name: '設定與備份', exact: true }).click();
  await expect(page.getByRole('heading', { name: '存到電腦資料夾', exact: true })).toBeVisible();
}

async function folderText(page: Page, name = mainFile, directory = directoryName): Promise<string | null> {
  return page.evaluate(async ({ directory, filename }) => {
    try {
      const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory);
      return await (await (await handle.getFileHandle(filename)).getFile()).text();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw error;
    }
  }, { directory, filename: name });
}

async function folderData(page: Page) {
  const text = await folderText(page);
  // The first native createWritable creates an empty entry before close commits.
  return text === null || text === '' ? null : JSON.parse(text);
}

async function writeFolderText(page: Page, content: string) {
  await page.evaluate(async ({ directory, filename, text }) => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory);
    const file = await handle.getFileHandle(filename, { create: true });
    const stream = await file.createWritable();
    await stream.write(text);
    await stream.close();
  }, { directory: directoryName, filename: mainFile, text: content });
}

async function chooseNewFolder(page: Page, mobile: boolean) {
  await settings(page, mobile);
  await page.getByRole('button', { name: '選擇本機資料夾', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '將食譜搬到這個資料夾？', exact: true })).toBeVisible();
  expect(await folderText(page), 'The picker and preview must not create or overwrite the file').toBeNull();
  await noOverflow(page);
  await page.getByRole('button', { name: '建立並搬到資料夾', exact: true }).click();
  await expect.poll(async () => (await folderData(page))?.data.recipes.length).toBe(6);
  await expect(page.getByRole('status').filter({ hasText: '已連接，修改後自動儲存' })).toBeVisible();
}

async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  for (const dialog of await page.getByRole('dialog').all()) {
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.viewport + 1);
  }
}

async function makeRecipe(page: Page, title: string) {
  await page.getByRole('button', { name: '新增食譜', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增食譜', exact: true });
  await editor.getByLabel('食譜名稱').fill(title);
  await editor.getByLabel('食材 1 名稱', { exact: true }).fill('雞腿肉');
  await editor.getByLabel('食材 1 份量', { exact: true }).fill('250');
  await editor.getByRole('textbox', { name: '第 1 步說明', exact: true }).fill('煎至雞肉中心達 75°C，再上碟。');
  await editor.locator('.editor-cover input[type="file"]').setInputFiles({
    name: 'folder-cover.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(editor.getByAltText('食譜封面預覽')).toBeVisible();
  await noOverflow(page);
  await editor.getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '食譜詳情' }).getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect.poll(async () => (await folderData(page))?.data.recipes.some((recipe: { title: string }) => recipe.title === title)).toBe(true);
}

test.beforeEach(async ({ context }) => { await installPicker(context); });

test('folder migration, recipe images and edits write actual JSON with a previous copy and survive reload', async ({ page, isMobile }, testInfo) => {
  await ready(page);
  await page.getByRole('button', { name: '收藏日式照燒雞', exact: true }).click();
  await chooseNewFolder(page, isMobile);
  const migrated = await folderData(page);
  expect(migrated.format).toBe('my-recipe-cookbook-folder');
  expect(migrated.version).toBe(1);
  expect(migrated.data.recipes.find((recipe: { id: string }) => recipe.id === 'demo-teriyaki-chicken').favorite).toBe(true);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/cookbook-local-folder-${testInfo.project.name}.png`, fullPage: true });
  await makeRecipe(page, '本機資料夾雞肉');
  const created = await folderData(page);
  expect(created.data.recipes.find((recipe: { title: string }) => recipe.title === '本機資料夾雞肉').image).toMatch(/^data:image\//);
  await page.getByRole('dialog').getByRole('button', { name: '編輯', exact: true }).click();
  await page.getByRole('dialog').getByLabel('食譜名稱').fill('本機資料夾雞肉改版');
  await page.getByRole('dialog').getByRole('button', { name: '儲存食譜', exact: true }).click();
  await expect.poll(async () => (await folderData(page))?.data.recipes.some((recipe: { title: string }) => recipe.title === '本機資料夾雞肉改版')).toBe(true);
  const previous = JSON.parse((await folderText(page, previousFile))!);
  expect(previous.data.recipes.some((recipe: { title: string }) => recipe.title === '本機資料夾雞肉')).toBe(true);
  expect(previous.revision).not.toBe((await folderData(page)).revision);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '食譜詳情' }).getByRole('heading', { name: '本機資料夾雞肉改版', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByAltText('本機資料夾雞肉改版')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '刪除食譜', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除這款食譜？', exact: true }).getByRole('button', { name: '確認刪除', exact: true }).click();
  await expect.poll(async () => (await folderData(page))?.data.recipes.length).toBe(6);
});

test('reselecting an existing folder after forgetting browser databases restores its file without overwriting it', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
  const savedText = await folderText(page);
  await page.evaluate(async () => {
    for (const name of ['my-recipe-cookbook', 'my-recipe-cookbook-folder-link']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Database deletion blocked'));
      });
    }
  });
  await page.reload();
  await settings(page, isMobile);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '選擇本機資料夾', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '開啟資料夾內的食譜？', exact: true })).toBeVisible();
  expect(await folderText(page)).toBe(savedText);
  await page.getByRole('button', { name: '開啟此資料夾的食譜', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await folderText(page), 'Opening existing data must not rewrite it').toBe(savedText);
  await noOverflow(page);
});

test('cancelled picker and a malformed existing folder preserve original browser data and file bytes', async ({ page, isMobile }) => {
  await ready(page);
  await settings(page, isMobile);
  await page.evaluate(() => localStorage.setItem('folder-test-picker', 'cancel'));
  await page.getByRole('button', { name: '選擇本機資料夾', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await folderText(page)).toBeNull();
  await page.evaluate(async () => {
    localStorage.removeItem('folder-test-picker');
    await (await navigator.storage.getDirectory()).getDirectoryHandle('電腦食譜庫', { create: true });
  });
  const broken = '{"format":"my-recipe-cookbook-folder","version":1,"data":"damaged"}';
  await writeFolderText(page, broken);
  await page.getByRole('button', { name: '選擇本機資料夾', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await folderText(page)).toBe(broken);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await folderText(page)).toBe(broken);
  await noOverflow(page);
});

test('remembered folder permission refusal blocks edits until the user reconnects while preserving file bytes', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  const savedText = await folderText(page);
  await page.evaluate(() => localStorage.setItem('folder-test-permission', 'denied'));
  await page.reload();
  await expect(page.getByRole('button', { name: '繼續使用此資料夾', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增食譜', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '繼續使用此資料夾', exact: true }).click();
  await expect(page.getByRole('button', { name: '繼續使用此資料夾', exact: true })).toBeVisible();
  expect(await folderText(page)).toBe(savedText);
  await noOverflow(page);
  await page.evaluate(() => localStorage.setItem('folder-test-request', 'grant'));
  await page.getByRole('button', { name: '繼續使用此資料夾', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增食譜', exact: true })).toBeVisible();
  await settings(page, isMobile);
  await expect(page.getByRole('status').filter({ hasText: '已連接，修改後自動儲存' })).toBeVisible();
  expect(await folderText(page)).toBe(savedText);
});

test('a live folder write failure retains unsaved changes and reconnecting saves them', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  const savedText = await folderText(page);
  await page.evaluate(() => localStorage.setItem('folder-test-write-failure', 'denied'));
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect(page.getByRole('alert').first()).toContainText('尚未儲存');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await folderText(page)).toBe(savedText);
  await page.evaluate(() => localStorage.setItem('folder-test-request', 'grant'));
  await page.getByRole('button', { name: '繼續使用此資料夾', exact: true }).click();
  await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
  await expect(page.getByRole('status').filter({ hasText: '已連接，修改後自動儲存' })).toBeVisible();
  expect(JSON.parse((await folderText(page, previousFile))!).data.theme).toBe('light');
});

test('a corrupted remembered file locks the app without replacing it and recovers from the preserved previous file', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
  const previous = (await folderText(page, previousFile))!;
  const corrupted = '{ damaged cookbook';
  await writeFolderText(page, corrupted);
  await page.reload();
  await expect(page.getByRole('heading', { name: '連接你的本機食譜', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增食譜', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('JSON 已損壞');
  expect(await folderText(page)).toBe(corrupted);
  expect(await folderText(page, previousFile)).toBe(previous);
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await expect(page.getByRole('heading', { name: '連接你的本機食譜', exact: true })).toBeVisible();
  expect(await folderText(page)).toBe(corrupted);
  await noOverflow(page);
  // This models restoring the saved previous file using a desktop file manager.
  await writeFolderText(page, previous);
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增食譜', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await folderText(page)).toBe(previous);
});

test('failure to remember a newly created destination keeps the previous folder active and allows a reviewed retry', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
  const originalText = await folderText(page);
  const secondName = '第二個食譜資料夾';
  await page.evaluate(name => {
    localStorage.setItem('folder-test-directory', name);
    localStorage.setItem('folder-test-registry', 'fail');
  }, secondName);
  await page.getByRole('button', { name: '選擇另一個資料夾', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '將食譜搬到這個資料夾？', exact: true })).toBeVisible();
  expect(await folderText(page, mainFile, secondName)).toBeNull();
  await page.getByRole('button', { name: '建立並搬到資料夾', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '開啟資料夾內的食譜？', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('alert')).toBeVisible();
  const secondText = await folderText(page, mainFile, secondName);
  expect(JSON.parse(secondText!).data.theme).toBe('dark');
  expect(await folderText(page)).toBe(originalText);
  const rememberedName = () => page.evaluate(async () => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('my-recipe-cookbook-folder-link', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('settings', 'readonly');
      const read = transaction.objectStore('settings').get('folder');
      read.onsuccess = () => resolve(read.result.name);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }));
  expect(await rememberedName()).toBe(directoryName);
  await expect(page.locator('.storage-status-bar')).toContainText(directoryName);
  await noOverflow(page);
  await page.evaluate(() => localStorage.removeItem('folder-test-registry'));
  await preview.getByRole('button', { name: '開啟此資料夾的食譜', exact: true }).click();
  await expect.poll(rememberedName).toBe(secondName);
  await expect(page.locator('.storage-status-bar')).toContainText(secondName);
  expect(await folderText(page, mainFile, secondName), 'A reviewed retry opens the already-created file without rewriting it').toBe(secondText);
  await page.getByRole('button', { name: /^淺色/ }).click();
  await expect.poll(async () => JSON.parse((await folderText(page, mainFile, secondName))!).data.theme).toBe('light');
  expect(await folderText(page), 'Later saves affect only the successfully remembered destination').toBe(originalText);
});

test('external folder file changes are never overwritten by a stale page', async ({ page, isMobile }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  const external = await folderData(page);
  external.revision = await page.evaluate(() => crypto.randomUUID());
  external.updatedAt = new Date().toISOString();
  external.data.recipes[0].notes = '從另一個視窗改動的煮食心得';
  const externalText = JSON.stringify(external);
  await writeFolderText(page, externalText);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect(page.getByRole('alert').first()).toContainText('尚未儲存');
  await expect(page.getByRole('button', { name: '重新讀取最新資料', exact: true })).toBeVisible();
  expect(await folderText(page)).toBe(externalText);
  await noOverflow(page);
  await page.getByRole('button', { name: '重新讀取最新資料', exact: true }).click();
  await page.getByRole('dialog', { name: '重新讀取最新資料？', exact: true }).getByRole('button', { name: '確認重新讀取', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await folderText(page)).toBe(externalText);
});

test('two tabs use file fingerprints and Web Locks to preserve the latest committed file', async ({ page, context, isMobile, browserErrors }) => {
  await ready(page);
  await chooseNewFolder(page, isMobile);
  const other = await context.newPage();
  other.on('pageerror', error => browserErrors.push(error.message));
  other.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await ready(other);
  await settings(other, isMobile);
  await page.getByRole('button', { name: /^深色/ }).click();
  await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
  const latestText = await folderText(page);
  await other.getByRole('textbox', { name: '新分類名稱', exact: true }).fill('另一分頁分類');
  await other.getByRole('button', { name: '新增分類', exact: true }).click();
  await expect(other.getByRole('alert').first()).toContainText('尚未儲存');
  await expect(other.getByRole('button', { name: '重新讀取最新資料', exact: true })).toBeVisible();
  expect(await folderText(other)).toBe(latestText);
  await other.close({ runBeforeUnload: false });
});

test('a full browser close and reopen restores the native directory handle and file data', async ({ isMobile }) => {
  test.skip(isMobile, 'The desktop standalone download is the target for a full persistent-browser restart.');
  const userDataDir = await mkdtemp(join(tmpdir(), 'cookbook-folder-browser-'));
  const options = { ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox'], viewport: { width: 1440, height: 1000 }, baseURL: 'http://127.0.0.1:5173' };
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(userDataDir, options);
    await installPicker(context);
    const page = context.pages()[0];
    await ready(page);
    await chooseNewFolder(page, false);
    await page.getByRole('button', { name: /^深色/ }).click();
    await expect.poll(async () => (await folderData(page))?.data.theme).toBe('dark');
    const savedText = await folderText(page);
    await context.close();
    context = await chromium.launchPersistentContext(userDataDir, options);
    await installPicker(context);
    const reopened = context.pages()[0];
    await reopened.goto('/');
    await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');
    await settings(reopened, false);
    await expect(reopened.getByRole('status').filter({ hasText: '已連接，修改後自動儲存' })).toBeVisible();
    expect(await folderText(reopened)).toBe(savedText);
    await reopened.getByRole('button', { name: /^淺色/ }).click();
    await expect.poll(async () => (await folderData(reopened))?.data.theme).toBe('light');
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
