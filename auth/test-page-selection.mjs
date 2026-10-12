import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const views = ['applications', 'sheet', 'jobs'];
const previews = views.map(view => new URL(`../jobfinder/preview/pages/playground-page-selection-${view}.astro`, import.meta.url));
const created = [];
let browser;
try {
  for (const [index, file] of previews.entries()) {
    await writeFile(file, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="${views[index]}" title="Current page selection" description="Entries and scoped selection" />
`, { flag: 'wx' });
    created.push(file);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const jobs = Array.from({ length: 53 }, (_, index) => ({ id: `page-${index}`, title: `Assistant ${index}`, company: 'Acme', location: 'Manila', employmentType: 'Full-time', role: 'Virtual assistance', url: `https://example.com/jobs/${index}`, source: 'Test feed', availability: 'open', salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Job description', direct: false }));
  const items = ['application', 'sheet'].flatMap((kind, group) => Array.from({ length: 53 }, (_, index) => ({ id: group * 100 + index + 1, kind, attachments: [], payload: { title: `Entry ${index}`, company: 'Acme', url: kind === 'application' ? jobs[index].url : '', jobId: jobs[index].id, source: jobs[index].source, status: index % 2 ? 'Saved' : 'Application opened', date: '2026-10-12', notes: '', salary: '', time: '', value: '' } })));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Page selection', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Test feed', configured: true } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  const checks = [];
  await context.route('**/api/jobs/availability', route => {
    const input = route.request().postDataJSON();
    checks.push(input);
    return route.fulfill({ status: 503, json: { error: 'Availability scans are removed.' } });
  });
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      const results=Array.from({length:4},(_,index)=>({title:index%2?'Longer automation engineer role with several tools and responsibilities':'Assistant',url:(index?'https:':'http:')+'//www.onlinejobs.ph/jobseekers/job/automation-'+index,content:'Automation job'}));
      window.drawSelectionGoogle=(empty=false,responseQuery=query)=>{window.__gcse.searchCallbacks.web.ready('joblink-google-jobs',responseQuery,[],empty?[]:results,organic);window.__gcse.searchCallbacks.web.rendered()};
      window.drawSelectionGoogle();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) { config.div.innerHTML='<div data-organic></div>';organic=config.div.firstElementChild; }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  for (const view of ['applications', 'sheet']) {
    await page.goto('/playground-page-selection-' + view);
    await page.locator('[data-ready=true]').waitFor();
    const prefix = view === 'applications' ? 'application' : 'sheet';
    const rows = page.locator(`[data-${prefix}-rows] tr`);
    const header = page.locator(`[data-${prefix}-all]`);
    const toolbar = page.locator(`[data-${prefix}-selection-toolbar]`);
    const entries = page.locator(`[data-${prefix}-entries]`);
    assert.equal(await rows.count(), 10);
    await header.check();
    assert.equal(await page.locator(`[data-${prefix}-pick]:checked`).count(), 10);
    await page.getByRole('button', { name: 'Page 2', exact: true }).click();
    assert.equal(await page.locator(`[data-${prefix}-pick]:checked`).count(), 0);
    assert.equal(await toolbar.isVisible(), false);
    await header.check();
    await page.getByRole('button', { name: 'Deselect this page', exact: true }).click();
    assert.equal(await header.isChecked(), false);
    await entries.selectOption('25');
    assert.equal(await rows.count(), 25);
    await header.check();
    assert.equal(await page.locator(`[data-${prefix}-pick]:checked`).count(), 25);
    await entries.selectOption('all');
    assert.equal(await rows.count(), 53);
    await header.check();
    assert.equal(await page.locator(`[data-${prefix}-pick]:checked`).count(), 53);
    const downloadReady = page.waitForEvent('download');
    await page.locator(`[data-${prefix}-export-selected]`).click();
    const stream = await (await downloadReady).createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString().trim().split('\r\n').length, 54);
    await page.reload();
    await page.locator('[data-ready=true]').waitFor();
    assert.equal(await entries.inputValue(), 'all');
    assert.equal(await rows.count(), 53);
    await entries.selectOption('10');
    const search = page.locator(view === 'applications' ? '[data-item-search]' : '[data-sheet-search]');
    await header.check();
    await search.fill('No matching entries');
    assert.equal(await rows.count(), 0);
    assert.equal(await toolbar.isVisible(), false);
    assert.equal(await header.isDisabled(), true);
  }
  await page.goto('/playground-page-selection-jobs');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^53 results$/ }).waitFor();
  const bulk = page.locator('[data-job-select-all]');
  const actions = page.locator('[data-job-selection-actions]');
  const toolbar = page.locator('[data-job-selection-toolbar]');
  assert.equal(await actions.isVisible(), false);
  await bulk.check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 12, 'Saved and opened jobs are included only on the current page');
  assert.equal(await actions.isVisible(), true);
  await page.locator('[data-job-deselect]').click();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 0);
  assert.equal(await actions.isVisible(), false, 'Clearing selection hides the separate action row');
  await bulk.check();
  await page.screenshot({ path: 'auth/runtime/explore-toolbar-desktop.png' });
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  assert.equal(await actions.isVisible(), false);
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 0);
  await page.locator('[data-job-entries]').selectOption('24');
  assert.equal(await page.locator('.job-card').count(), 24);
  await bulk.check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 24);
  await page.locator('[data-job-entries]').selectOption('all');
  assert.equal(await page.locator('.job-card').count(), 53);
  await bulk.check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 53);
  await page.locator('#job-location').fill('No matching location');
  assert.equal(await toolbar.isVisible(), false);
  assert.equal(await actions.isVisible(), false);
  await page.locator('#job-source').selectOption('google');
  await page.waitForFunction(() => document.querySelectorAll('.google-job-card').length === 4);
  assert.equal(await page.locator('[data-retry-job-availability]').count(), 0);
  assert.deepEqual(checks, [], 'Google cards render without availability requests');
  assert.equal(await page.locator('.google-job-card [data-job-source-listing]').first().getAttribute('href'), 'https://www.onlinejobs.ph/jobseekers/job/automation-0');
  assert.equal(await actions.isVisible(), false);
  await bulk.check();
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 4);
  await page.locator('[data-job-deselect]').click();
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 0);
  assert.equal(await actions.isVisible(), false);
  await bulk.check();
  await page.evaluate(() => window.drawSelectionGoogle(false, 'outdated query'));
  assert.equal(await page.locator('.google-job-card').count(), 4, 'An old Google callback cannot clear the current cards');
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 4);
  await page.evaluate(() => window.drawSelectionGoogle(true));
  await page.locator('[data-job-count]').filter({ hasText: /^0 results on this page$/ }).waitFor();
  assert.equal(await toolbar.isVisible(), false);
  assert.equal(await actions.isVisible(), false);
  assert.equal(await page.locator('[data-retry-job-availability]').count(), 0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 768) await page.locator('.sidebar-close').evaluate(button => button.click());
    await page.evaluate(() => window.drawSelectionGoogle());
    await page.waitForFunction(() => document.querySelectorAll('.google-job-card').length === 4);
    await bulk.check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `auth/runtime/page-selection-google-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: current-page bulk selection for jobs/applications/sheet, Show entries and All, exports, preference restore, hidden actions and empty toolbars, scan-free Google rendering, Google empty transitions and responsive layout.');
} finally {
  await browser?.close();
  await Promise.all(created.map(file => unlink(file)));
}
