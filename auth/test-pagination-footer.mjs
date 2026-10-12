import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Use real tables and mocked reads, without creating accounts or editing data.
const views = [
  { view: 'applications', kind: 'application', count: 23, noun: 'applications', search: '[data-item-search]' },
  { view: 'sheet', kind: 'sheet', count: 13, noun: 'rows', search: '[data-sheet-search]' },
];
const created = [];
let browser;
try {
  for (const { view } of views) {
    const preview = new URL(`../jobfinder/preview/pages/playground-pagination-${view}.astro`, import.meta.url);
    await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="${view}" title="Pagination preview" description="Table pagination verification" />
`, { flag: 'wx' });
    created.push(preview);
  }
  browser = await chromium.launch({
    executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
    headless: true,
  });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const items = views.flatMap(({ kind, count }) => Array.from({ length: count }, (_, index) => ({
    id: (kind === 'sheet' ? 100 : 0) + index + 1, kind, attachments: [],
    payload: { title: index === 0 ? 'Unique role' : `Fixture ${index}`, company: 'Example', status: 'Saved', date: '2026-10-12', salary: '', value: '', notes: '', url: '' },
  })));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items } }));
  for (const { view, kind, count, noun, search } of views) {
    await page.setViewportSize({ width: 1530, height: 1000 });
    await page.goto(`/playground-pagination-${view}`);
    await page.locator('[data-ready=true]').waitFor();
    const footer = page.locator(`[data-${kind}-pagination]`);
    const previous = footer.getByRole('button', { name: 'Previous page', exact: true });
    assert.equal(await previous.count(), 0, 'Previous is absent on page one');
    assert.equal(await footer.locator('[role=status]').innerText(), `Showing 1–10 of ${count} ${noun}`);
    const layout = await footer.evaluate(nav => {
      const rect = nav.getBoundingClientRect();
      const countBox = nav.querySelector('[role=status]').getBoundingClientRect();
      const pages = nav.querySelector('.pagination').getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(nav).paddingLeft);
      return { leftOffset: countBox.left - rect.left - padding, countMiddle: (countBox.top + countBox.bottom) / 2, pagesMiddle: (pages.top + pages.bottom) / 2, centerOffset: (pages.left + pages.right - rect.left - rect.right) / 2 };
    });
    assert.ok(Math.abs(layout.leftOffset) < 2, 'Count starts at the left of the table footer');
    assert.ok(Math.abs(layout.countMiddle - layout.pagesMiddle) < 2, 'Count sits alongside the controls');
    assert.ok(Math.abs(layout.centerOffset) < 2, 'Pagination stays centered');
    await footer.getByRole('button', { name: 'Page 2', exact: true }).click();
    assert.equal(await footer.locator('[role=status]').innerText(), `Showing 11–${Math.min(20, count)} of ${count} ${noun}`);
    await previous.click();
    assert.equal(await previous.count(), 0, 'Returning to page one removes Previous');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await footer.evaluate(nav => {
      const countBox = nav.querySelector('[role=status]').getBoundingClientRect();
      const pages = nav.querySelector('.pagination').getBoundingClientRect();
      return countBox.top >= pages.bottom && nav.scrollWidth <= nav.clientWidth;
    }), true, 'Mobile count sits below the controls without footer overflow');
    await page.locator(search).fill('Unique role');
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Showing 1–1 of 1'), `[data-${kind}-pagination]`);
    assert.equal(await footer.isVisible(), true, 'A single page still shows the row count');
    assert.equal(await footer.locator('.pagination').count(), 0);
    console.log(`PASS ${view}: left row count, centered controls, Previous only after page one, mobile and single-page results.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await Promise.all(created.map(preview => unlink(preview)));
}
