import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Exercise the real workspace UI with isolated fixtures. No accounts, database
// rows, or attachment files are created by this regression test.
const preview = new URL('../jobfinder/preview/pages/playground-workspace-removal-test.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
const view = Astro.url.searchParams.get('view') || 'applications'
---
<WorkspacePage view={view} title="Removal preview" description="Mocked workspace removal checks." />
`, { flag: 'wx' });
let browser;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function item(id, kind, title = `${kind} ${id}`, overrides = {}) {
  return {
    id, kind, attachments: [],
    payload: { title, company: 'Fixture company', status: kind === 'application' ? 'Saved' : 'To do', notes: '', date: today, time: '10:00', salary: '', value: '', url: 'https://example.invalid/careers', ...overrides },
  };
}
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  async function open(view, fixture, width = 1440) {
    const state = { items: structuredClone(fixture), writes: [], failNext: false, failBatch: 0, batches: 0 };
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.workspaceCacheWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === sessionStorage && key === 'joblink-page-data-v1:workspace') window.workspaceCacheWrites++;
        return original.call(this, key, value);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 987654, name: 'Removal fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'removal-fixture', googleEnabled: false } }));
    await context.route('**/api/workspace/items', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { items: state.items } });
      assert.equal(route.request().headers()['x-csrf-token'], 'removal-fixture');
      const input = route.request().postDataJSON();
      state.writes.push(input);
      if (input.action === 'bulk-delete') state.batches++;
      if (state.failNext || (state.failBatch && state.batches === state.failBatch)) {
        state.failNext = false;
        state.failBatch = 0;
        return route.fulfill({ status: 503, json: { error: 'Removal is temporarily unavailable. Try again.' } });
      }
      if (input.action === 'bulk-delete') {
        const deleted = state.items.filter(row => input.ids.includes(row.id) && row.kind === input.kind).map(row => row.id);
        state.items = state.items.filter(row => !deleted.includes(row.id));
        return route.fulfill({ json: { deleted } });
      }
      if (input.action === 'delete-status') {
        const list = state.items.find(row => row.id === input.id);
        state.items = state.items.filter(row => row.id !== input.id);
        const updated = state.items.filter(row => row.kind === 'task' && row.payload.status === list.payload.title);
        for (const row of updated) row.payload.status = 'To do';
        return route.fulfill({ json: { deleted: input.id, updated } });
      }
      assert.equal(input.action, 'delete', 'The removal test should issue only removal requests');
      state.items = state.items.filter(row => row.id !== input.id);
      return route.fulfill({ json: { deleted: input.id } });
    });
    await page.goto(`/playground-workspace-removal-test?view=${view}`);
    await page.locator('[data-ready=true]').waitFor();
    await page.waitForFunction(() => window.workspaceCacheWrites > 0);
    if (width < 992) await page.locator('.sidebar-close').evaluate(button => button.click());
    return { page, context, state, errors };
  }
  async function prompt(page, kind, id) {
    if (kind === 'application' || kind === 'sheet') {
      await page.locator(`[data-${kind === 'application' ? 'application' : 'sheet'}-actions="${id}"]`).click();
      const action = page.locator('[data-table-delete]');
      assert.equal(await action.innerText(), kind === 'application' ? 'Remove application' : 'Remove row');
      assert.match(await action.getAttribute('aria-label'), /^Remove /);
      await action.click();
    } else {
      const action = page.locator(`[data-delete="${id}"]`);
      assert.equal(await action.innerText(), 'Remove');
      assert.match(await action.getAttribute('aria-label'), /^Remove /);
      await action.click();
    }
    await page.locator('[data-confirm-modal]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-confirm-accept]').innerText(), 'Remove');
    assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false, 'Success waits for a confirmed and completed removal');
  }
  async function success(page, message, dismiss = 'button') {
    const dialog = page.locator('[data-removal-success-modal]');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-removal-success-title]').innerText(), 'Removed successfully');
    assert.equal(await page.locator('[data-removal-success-message]').innerText(), message);
    assert.equal(await page.locator('[data-confirm-modal]').isVisible(), false, 'Only the success dialog remains visible');
    await page.waitForFunction(() => document.querySelector('[data-removal-success-close]') === document.activeElement);
    const bounds = await dialog.locator('.modal-dialog').boundingBox();
    const viewport = page.viewportSize();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'The success dialog fits the viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    else await page.locator('[data-removal-success-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  }

  // Cancellation and server errors preserve rows and never report success.
  {
    const { page, context, state, errors } = await open('applications', [item(1, 'application', 'Selected role'), item(2, 'sheet', 'Keep row')]);
    await prompt(page, 'application', 1);
    await page.locator('[data-confirm-modal]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('[data-confirm-modal]').waitFor({ state: 'hidden' });
    assert.equal(state.writes.length, 0);
    assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false);
    state.failNext = true;
    await prompt(page, 'application', 1);
    await page.locator('[data-confirm-accept]').click();
    await page.locator('[data-workspace-error]').filter({ hasText: 'Removal is temporarily unavailable' }).waitFor();
    assert.equal(state.items.length, 2);
    assert.equal(await page.locator('[data-application-actions="1"]').count(), 1);
    assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false, 'Failure never shows a success message');
    await prompt(page, 'application', 1);
    await page.locator('[data-confirm-accept]').click();
    await success(page, 'The application was removed.', 'escape');
    assert.deepEqual(state.items.map(row => row.id), [2]);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // The same wording and dialog apply to cards, events, links, and sheet rows.
  for (const [kind, view, width] of [['sheet', 'sheet', 320], ['task', 'taskboard', 1440], ['event', 'calendar', 390], ['link', 'links', 1440]]) {
    const fixture = item(1, kind, 'Remove this item');
    if (kind === 'sheet') fixture.attachments = [{ id: 20, name: 'notes.txt', mime: 'text/plain', size: 12 }];
    const { page, context, state, errors } = await open(view, [fixture, item(2, 'application', 'Keep application')], width);
    await prompt(page, kind, 1);
    await page.locator('[data-confirm-accept]').click();
    await success(page, `The ${kind === 'sheet' ? 'row' : kind} was removed.${kind === 'sheet' ? ' Any attached files were removed too.' : ''}`);
    assert.deepEqual(state.items.map(row => row.id), [2]);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Removing a custom list retains its tasks and places them in To do.
  {
    const { page, context, state, errors } = await open('taskboard', [item(1, 'task_status', 'Review'), item(2, 'task', 'Keep task', { status: 'Review' })]);
    const remove = page.getByRole('button', { name: 'Remove list Review', exact: true });
    await remove.click();
    await page.locator('[data-confirm-modal]').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(state.writes.length, 0);
    await remove.click();
    await page.locator('[data-confirm-accept]').click();
    await success(page, 'The list was removed. Its tasks were moved to To do.');
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].payload.status, 'To do');
    assert.equal(await page.locator('[data-task-column="To do"] [data-task-card="2"]').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Selection updates retain row inputs. Bulk success covers only removed rows.
  for (const [kind, view, prefix, width] of [['application', 'applications', 'application', 1440], ['sheet', 'sheet', 'sheet', 390]]) {
    const { page, context, state, errors } = await open(view, [item(1, kind), item(2, kind), item(3, kind), item(4, 'link', 'Keep link')], width);
    const cacheWrites = await page.evaluate(() => window.workspaceCacheWrites);
    const search = page.locator(prefix === 'application' ? '[data-item-search]' : '[data-sheet-search]');
    await search.fill('no matching fixture');
    await search.fill('');
    if (prefix === 'application') await search.press('Escape');
    const row = await page.locator(`[data-${prefix}-rows] tr`).first().elementHandle();
    await page.locator(`[data-${prefix}-pick="1"]`).check();
    assert.equal(await row.evaluate(node => node.isConnected), true, 'Selecting a row preserves its DOM and current inputs');
    await page.locator(`[data-${prefix}-pick="1"]`).uncheck();
    await page.locator(`[data-${prefix}-pick="1"]`).check();
    const bulk = page.locator(`[data-${prefix}-bulk]`);
    assert.match(await bulk.innerText(), /^Remove selected(?: \(1\))?$/);
    await page.locator(`[data-${prefix}-pick="2"]`).check();
    assert.equal(await page.evaluate(() => window.workspaceCacheWrites), cacheWrites, 'Selecting, deselecting, and filtering do not serialize the unchanged workspace again');
    state.failNext = true;
    await bulk.click();
    await page.locator('[data-confirm-accept]').click();
    await page.locator('[data-workspace-error]').filter({ hasText: 'Removal is temporarily unavailable' }).waitFor();
    assert.equal(state.items.length, 4);
    assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false);
    await bulk.click();
    await page.locator('[data-confirm-accept]').click();
    await success(page, `2 ${kind === 'sheet' ? 'rows' : 'applications'} were removed. Any attached files were removed too.`);
    assert.deepEqual(state.items.map(row => row.id), [3, 4]);
    assert.equal(await page.locator(`[data-${prefix}-selection-toolbar]`).isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // A second batch failure reports an error and leaves remaining rows retryable.
  {
    const fixture = Array.from({ length: 205 }, (_, index) => item(index + 1, 'application'));
    const { page, context, state, errors } = await open('applications', fixture);
    const cacheWrites = await page.evaluate(() => window.workspaceCacheWrites);
    await page.getByRole('button', { name: 'Page 2', exact: true }).click();
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await page.locator('[data-application-entries]').selectOption('all');
    await page.locator('[data-application-all]').check();
    assert.equal(await page.evaluate(() => window.workspaceCacheWrites), cacheWrites, 'Pagination, entry count, and select-all do not rewrite the unchanged workspace cache');
    state.failBatch = 2;
    await page.locator('[data-application-bulk]').click();
    await page.locator('[data-confirm-accept]').click();
    await page.locator('[data-workspace-error]').filter({ hasText: 'Removal is temporarily unavailable' }).waitFor();
    assert.equal(state.items.length, 5);
    assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false, 'An incomplete bulk operation must not report full success');
    assert.equal(await page.locator('[data-application-selected-count]').innerText(), '5 selected');
    await page.locator('[data-application-bulk]').click();
    await page.locator('[data-confirm-accept]').click();
    await success(page, '5 applications were removed. Any attached files were removed too.');
    assert.equal(state.items.length, 0);
    assert.deepEqual(state.writes.map(write => write.ids.length), [200, 5, 5]);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: consistent Remove labels and success dialog, single/bulk removal, attachments, custom lists, cancellation, failed requests and partial-batch retry, keyboard dismissal, mobile layout, and row-preserving selection.');
} finally {
  await browser?.close();
  await unlink(preview);
}
