import assert from 'node:assert/strict';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Render the real component on an ignored local preview route. All account
// and workspace requests use fixtures; this test never writes to the database.
const preview = new URL('../jobfinder/preview/pages/playground-application-tracker-test.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="applications" title="Job application tracker" description="Every application in one place, so nothing slips through." />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  let items = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1, kind: 'application', attachments: [], payload: {
      title: index < 2 ? 'Software Engineer' : index === 25 ? '<img src=x onerror=window.injected=true>' : `Tracked role ${index + 1}`,
      company: index === 0 ? 'Acme' : index === 1 ? 'Polar' : `Company ${index + 1}`,
      status: index === 0 ? 'Application opened' : index === 2 ? 'Interview' : 'Saved',
      notes: index === 24 ? 'Distinct note' : '', date: index === 25 ? '2026-10-10' : index === 24 ? '2026-10-11' : '2026-10-12', salary: '', url: `https://example.com/jobs/${index + 1}`,
    },
  }));
  let rejectUpdate = true;
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Tracker preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'tracker-fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    const data = route.request().postDataJSON();
    assert.equal(route.request().headers()['x-csrf-token'], 'tracker-fixture');
    writes.push(data);
    if (rejectUpdate && data.payload?.status === 'Applied') {
      rejectUpdate = false;
      return route.fulfill({ status: 503, json: { error: 'Fixture save failed. Try again.' } });
    }
    if (data.action === 'delete') {
      items = items.filter(item => item.id !== data.id);
      return route.fulfill({ json: { deleted: data.id } });
    }
    const item = items.find(item => item.id === data.id);
    item.payload = data.payload;
    return route.fulfill({ json: { item } });
  });
  await page.goto('/playground-application-tracker-test');
  await page.locator('[data-ready=true]').waitFor();
  const search = page.getByRole('combobox', { name: 'Search applications' });
  const suggestions = page.getByRole('listbox', { name: 'Tracked jobs' });
  const menu = page.getByRole('menu', { name: 'Application actions' });
  async function assertMenuHighlight(item, color, other) {
    await item.hover();
    const actual = await item.evaluate((node, color) => {
      const sample = document.createElement('span');
      sample.style.backgroundColor = `var(--tblr-${color})`;
      node.append(sample);
      const expected = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return { actual: getComputedStyle(node).backgroundColor, expected };
    }, color);
    assert.equal(actual.actual, actual.expected);
    assert.notEqual(await other.evaluate(node => getComputedStyle(node).backgroundColor), actual.expected, 'Hover highlights one menu item at a time');
  }
  async function setFilter(label, value) {
    const control = page.getByLabel(label);
    if (!await control.isVisible()) await page.locator('[data-application-filter-toggle]').click();
    await control.selectOption(value);
    await page.locator('[data-application-filter-toggle]').click();
  }
  async function setSort(value) {
    await page.locator('[data-application-sort-toggle]').click();
    await page.getByLabel('Sort applications').selectOption(value);
    await page.locator('[data-application-sort-toggle]').click();
  }
  await page.locator('[data-application-pick="1"]').check();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.locator('[data-application-pick="13"]').check();
  assert.equal(await page.locator('[data-application-selected-count]').innerText(), '1 selected');
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  assert.equal(await page.locator('[data-application-pick="1"]').isChecked(), false);
  await page.locator('[data-application-pick="1"]').check();
  await setFilter('Filter application company', 'Acme');
  assert.equal(await page.locator('[data-application-selected-count]').innerText(), '1 selected');
  assert.equal(await page.locator('[data-application-rows] tr').count(), 1);
  assert.equal(await page.locator('[data-application-filter-badge]').innerText(), '1');
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export selected', exact: true }).click();
  const download = await downloadReady;
  const stream = await download.createReadStream();
  const csv = [];
  for await (const chunk of stream) csv.push(chunk);
  const exported = Buffer.concat(csv).toString('utf8');
  assert.equal(exported.trim().split('\r\n').length, 2, 'Export contains only the selected visible job');
  assert.ok(!exported.includes('Tracked role 13'));
  await setFilter('Filter application company', '');
  await page.locator('[data-application-entries]').selectOption('all');
  await page.getByLabel('Select applications on this page').check();
  assert.equal(await page.locator('[data-application-selected-count]').innerText(), '26 selected');
  await page.getByRole('button', { name: 'Deselect this page', exact: true }).click();
  assert.equal(await page.locator('[data-application-selection-toolbar]').isVisible(), false);
  assert.equal(await page.locator('[data-application-pick]:checked').count(), 0);
  assert.equal(await page.locator('[data-application-all]').isChecked(), false);
  assert.equal(await page.locator('[data-application-all]').evaluate(input => input.indeterminate), false);
  await page.locator('[data-application-entries]').selectOption('10');
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  assert.equal(await page.locator('[data-application-pick]:checked').count(), 0, 'Clearing also deselects other pages');
  await page.locator('[data-application-pick="13"]').check();
  await setFilter('Filter application company', 'Acme');
  assert.equal(await page.locator('[data-application-selection-toolbar]').isVisible(), false);
  assert.equal(await page.locator('[data-application-selection-toolbar]').isVisible(), false, 'Deselect works repeatedly with hidden selections');
  await setFilter('Filter application company', '');
  await page.locator('[data-application-pick="1"]').check();
  await page.locator('[data-application-all]').check();
  await page.getByRole('button', { name: 'Deselect this page', exact: true }).click();
  assert.equal(await page.locator('[data-application-selection-toolbar]').isVisible(), false, 'The select/deselect toggle also clears selection');
  await setSort('oldest');
  assert.equal(await page.locator('[data-application-pick]').first().getAttribute('data-application-pick'), '26');
  await setSort('title');
  assert.equal(await page.locator('[data-application-pick]').first().getAttribute('data-application-pick'), '26');
  await setSort('company');
  assert.equal(await page.locator('[data-application-rows] tr td').nth(3).getByText('Acme', { exact: true }).count(), 1);
  await setSort('status');
  assert.equal(await page.locator('[data-entry-status]').first().inputValue(), 'Interview');
  assert.equal(await page.locator('[data-entry-status] option').filter({ hasText: 'Application opened' }).count(), 0, 'Removed status is absent from choices');
  await setSort('newest');
  await setFilter('Filter application status', 'Interview');
  await setFilter('Filter application company', 'Acme');
  assert.equal(await page.locator('[data-application-filter-badge]').innerText(), '2');
  assert.equal(await page.locator('[data-application-rows] tr').count(), 0, 'Status and company filters combine');
  assert.equal(await page.locator('[data-application-all]').isDisabled(), true);
  await page.locator('[data-application-filter-toggle]').click();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.locator('[data-application-filter-toggle]').click();
  assert.equal(await page.locator('[data-application-rows] tr').count(), 10);
  assert.equal(await page.locator('[data-application-filter-badge]').isVisible(), false);
  await search.click();
  assert.equal(await suggestions.getByRole('option').count(), 26, 'Suggestions include every tracker page');
  assert.equal(await suggestions.locator('img').count(), 0, 'Job titles are rendered as text');
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await search.fill('software');
  assert.equal(await suggestions.getByRole('option').count(), 2, 'Duplicate roles retain separate company choices');
  await suggestions.getByRole('option').filter({ hasText: 'Polar' }).click();
  assert.equal(await page.locator('[data-application-rows] tr').count(), 1);
  assert.equal(await page.locator('[data-application-rows] tr td').nth(3).getByText('Polar', { exact: true }).count(), 1);
  assert.equal(await search.getAttribute('aria-expanded'), 'false');
  await page.locator('[data-application-filter-toggle]').click();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.locator('[data-application-filter-toggle]').click();
  assert.equal(await search.inputValue(), '', 'Clear filters resets a chosen tracked-job search');
  assert.equal(await page.locator('[data-application-filter-count]').innerText(), '26 of 26 jobs');
  await search.fill('Distinct note');
  assert.equal(await suggestions.getByRole('option').count(), 1, 'Search includes notes and jobs outside the current page');
  await search.press('ArrowDown');
  await search.press('Enter');
  assert.equal(await page.locator('[data-application-actions="25"]').count(), 1);
  await search.fill('');
  await search.press('ArrowUp');
  assert.equal(await search.getAttribute('aria-activedescendant'), 'application-search-suggestions-25');
  await search.press('Escape');
  assert.equal(await search.getAttribute('aria-expanded'), 'false');
  await search.fill('Company');
  await setFilter('Filter application status', 'Interview');
  await search.click();
  assert.equal(await suggestions.getByRole('option').count(), 1, 'Suggestions respect status filters');
  await search.press('Escape');
  await setFilter('Filter application status', '');
  await search.fill('');
  await search.press('Escape');
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await search.focus();
  await search.fill('Acme');
  assert.equal(await page.locator('[data-application-pagination] [data-application-page]').count(), 0, 'Searching removes controls for other pages');
  await search.press('Escape');
  const actions = page.locator('[data-application-actions="1"]');
  await actions.click();
  assert.equal(await actions.locator('svg.workspace-action-chevron').count(), 1, 'Row actions have a down arrow');
  assert.equal(await menu.isVisible(), true);
  assert.equal(await page.getByRole('menuitem', { name: 'Mark as applied' }).isVisible(), true);
  await assertMenuHighlight(menu.locator('[data-table-delete]'), 'danger', menu.locator('[data-table-edit]'));
  assert.equal(await menu.locator('[data-table-mark]').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)', 'The initially focused action loses its highlight when another option is hovered');
  await assertMenuHighlight(menu.locator('[data-table-edit]'), 'hover-bg', menu.locator('[data-table-delete]'));
  await page.getByRole('menuitem', { name: 'Mark as applied' }).click();
  await page.locator('[data-workspace-error]').filter({ hasText: 'Fixture save failed' }).waitFor();
  assert.equal(items[0].payload.status, 'Application opened', 'Failed updates keep the original status');
  await actions.click();
  await page.getByRole('menuitem', { name: 'Mark as applied' }).click();
  await page.waitForFunction(() => document.querySelector('[data-entry-status="1"]')?.value === 'Applied');
  assert.equal(await page.locator('[data-application-stat=open]').innerText(), '2');
  await actions.click();
  assert.equal(await page.getByRole('menuitem', { name: 'Mark as applied' }).count(), 0, 'Applied jobs omit the redundant action');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('menuitem', { name: 'Remove Software Engineer', exact: true }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await actions.getAttribute('aria-expanded'), 'false');
  assert.equal(await actions.evaluate(button => button === document.activeElement), true, 'Escape returns focus to the row');
  await actions.click();
  await page.getByRole('menuitem', { name: 'Edit application', exact: true }).click();
  await page.getByLabel('Title / role', { exact: true }).fill('Updated Software Engineer');
  await page.locator('[data-entry-form] button[type=submit]').click();
  await page.locator('[data-entry-modal]').waitFor({ state: 'hidden' });
  await search.fill('');
  await search.press('Escape');
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await page.locator('[data-application-actions="26"]').click();
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.y >= 0 && menuBox.y + menuBox.height <= 1000, 'Last-row menu stays in the viewport');
  await page.getByRole('menuitem', { name: 'Remove <img src=x onerror=window.injected=true>', exact: true }).click();
  await page.locator('[data-confirm-modal]').waitFor({ state: 'visible' });
  await page.locator('[data-confirm-modal]').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('[data-confirm-modal]').waitFor({ state: 'hidden' });
  assert.equal(items.length, 26, 'Cancel preserves the application');
  assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false, 'Cancel does not show removal success');
  await page.locator('[data-application-actions="26"]').click();
  await page.getByRole('menuitem', { name: 'Remove <img src=x onerror=window.injected=true>', exact: true }).click();
  await page.locator('[data-confirm-accept]').click();
  await page.locator('[data-application-actions="26"]').waitFor({ state: 'detached' });
  assert.equal(items.length, 25);
  await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-removal-success-title]').innerText(), 'Removed successfully');
  assert.equal(await page.locator('[data-removal-success-message]').innerText(), 'The application was removed.');
  await page.locator('[data-removal-success-close]').click();
  await page.locator('[data-removal-success-modal]').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await page.locator('[data-application-table]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'auth/runtime/tracker-table-desktop.png' });
  await page.locator('[data-application-filter-toggle]').click();
  await page.screenshot({ path: 'auth/runtime/tracker-filters-desktop.png' });
  await page.locator('[data-application-filter-toggle]').click();
  await page.locator('[data-application-sort-toggle]').click();
  await page.screenshot({ path: 'auth/runtime/tracker-sort-desktop.png' });
  await page.locator('[data-application-sort-toggle]').click();
  await page.locator('[data-application-actions="2"]').click();
  await mkdir(new URL('./runtime/', import.meta.url), { recursive: true });
  await page.screenshot({ path: 'auth/runtime/tracker-actions-desktop.png' });
  await page.keyboard.press('Escape');
  await search.fill('Software');
  await page.screenshot({ path: 'auth/runtime/tracker-search-desktop.png' });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.sidebar-close').evaluate(button => button.click());
    await page.waitForTimeout(300);
    await search.fill('');
    await search.focus();
    const box = await suggestions.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'Search suggestions fit mobile widths');
    await search.press('Escape');
    for (const selector of ['[data-application-filter-toggle]', '[data-application-sort-toggle]']) {
      await page.locator(selector).click();
      const dropdown = page.locator('.workspace-filter-menu.show');
      await dropdown.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const dropdownBox = await dropdown.boundingBox();
      assert.ok(dropdownBox.x >= -1 && dropdownBox.x + dropdownBox.width <= width + 1, `Filter and sort dropdowns fit smaller screens: ${JSON.stringify({width, selector, dropdownBox})}`);
      if (width === 390 && selector.includes('filter')) await page.screenshot({ path: 'auth/runtime/tracker-filters-mobile.png' });
      await page.locator(selector).click();
    }
    await page.locator('[data-application-actions="10"]').click();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Actions escape the scrollable table and fit the viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 390) await page.screenshot({ path: 'auth/runtime/tracker-actions-mobile.png' });
    await page.keyboard.press('Escape');
    await page.locator('[data-application-pick="10"]').check();
    await page.locator('[data-application-all]').check();
    await page.getByRole('button', { name: 'Deselect this page', exact: true }).click();
    assert.equal(await page.locator('[data-application-pick]:checked').count(), 0, 'Deselect works on mobile');
  }
  assert.equal(writes.filter(write => write.action === 'delete').length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: Bootstrap filters/sort, current-page selection and explicit All entries, selected CSV, tracker suggestions, keyboard controls, actions, retry, edit/remove confirmation and success, pagination and mobile layout.');
} finally {
  await browser?.close();
  await unlink(preview);
}
