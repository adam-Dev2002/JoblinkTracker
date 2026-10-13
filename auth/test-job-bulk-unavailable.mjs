import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Real workspace UI with mocked storage; no account or database writes.
const preview = new URL('../jobfinder/preview/pages/playground-bulk-unavailable.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Bulk unavailable" description="Selected posting availability" />
`, { flag: 'wx' });
let browser, release;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  const job = index => ({ id: `unavailable-bulk-${index}`, title: `Assistant ${index}`, company: 'Fixture company', location: 'Manila',
    employmentType: 'Full-time', role: 'Virtual assistance', url: `https://example.com/jobs/${index}`, source: 'Test feed',
    salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Assistant job', direct: false });
  const jobs = Array.from({ length: 16 }, (_, index) => job(index));
  jobs[14].availability = 'closed';
  const google = Array.from({ length: 12 }, (_, index) => ({ ...job(index + 100), url: `https://www.onlinejobs.ph/jobseekers/job/bulk-${index}`, title: `Google Assistant ${index}` }));
  const entry = (id, row, status) => ({ id, kind: 'application', payload: { ...row, jobId: row.id, status, notes: `Personal note ${id}`, date: '2026-10-01' } });
  const items = [entry(1, jobs[0], 'Saved'), entry(2, jobs[1], 'Application opened'), entry(3, jobs[2], 'Saved'), entry(4, jobs[15], 'Applied'),
    ...google.map((row, index) => entry(900 + index, row, index % 2 ? 'Saved' : 'Application opened'))];
  const originals = new Map(items.map(item => [item.id, structuredClone(item.payload)]));
  let failOnce = true, held = false;
  const hold = new Promise(resolve => { release = resolve; });
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Unavailable fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Fixture jobs' } }));
  await context.route('**/api/workspace/items', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    const input = route.request().postDataJSON();
    assert.equal(input.payload.status, 'Unavailable');
    assert.equal(route.request().headers()['x-csrf-token'], 'fixture');
    writes.push(input);
    if (!held) { held = true; await hold; }
    if (input.payload.jobId === jobs[2].id && failOnce) {
      failOnce = false;
      return route.fulfill({ status: 503, json: { error: 'Could not mark this posting unavailable. Retry.' } });
    }
    let item = items.find(item => item.id === input.id);
    if (item) item.payload = input.payload;
    else { item = { id: 2000 + writes.length, kind: 'application', payload: input.payload }; items.push(item); }
    return route.fulfill({ json: { item } });
  });
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      window.redrawBulkUnavailable = () => {
        window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(google.map(row => ({ title: row.title, url: row.url, content: row.description })))}, organic);
        window.__gcse.searchCallbacks.web.rendered();
      };
      window.redrawBulkUnavailable();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div></div>';
      organic = config.div.querySelector('[data-organic]');
      config.div.addEventListener('click', event => event.stopPropagation());
      config.div.addEventListener('change', event => event.stopPropagation());
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  const bulk = page.locator('[data-job-bulk-unavailable]');
  const header = page.locator('[data-job-select-all]');
  const done = async count => {
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-removal-success-message]').innerText(), new RegExp(`^${count} ${count === 1 ? 'job was' : 'jobs were'} marked unavailable`));
    await page.locator('[data-removal-success-close]').click();
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'hidden' });
  };
  await page.goto('/playground-bulk-unavailable');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^14 results$/ }).waitFor();
  assert.equal((await bulk.innerText()).trim(), 'Mark selected unavailable');
  assert.equal(await bulk.isDisabled(), true);
  await header.check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 12);
  await bulk.click();
  await page.locator('[data-job-selection-toolbar][aria-busy=true]').waitFor();
  assert.equal(await bulk.isDisabled(), true);
  assert.equal(await header.isDisabled(), true);
  assert.equal(await page.locator('[data-job-bulk-apply]').isDisabled(), true);
  assert.equal(await page.locator('[data-apply-job]').first().getAttribute('aria-disabled'), 'true');
  await bulk.dispatchEvent('click');
  release();
  await page.locator('[data-job-bulk-status]').filter({ hasText: '11 jobs marked unavailable.' }).waitFor();
  assert.equal(writes.length, 12, 'One operation attempts each selected posting once');
  assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false, 'Partial failures never show a complete-success dialog');
  assert.equal(await page.locator('.job-card').count(), 3);
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 1);
  assert.equal(await page.locator(`[data-job-pick="${jobs[2].id}"]`).isChecked(), true);
  assert.equal(items.some(item => item.payload.jobId === jobs[12].id), false, 'Unselected jobs are untouched');
  assert.equal(items.some(item => item.payload.jobId === jobs[13].id), false);
  assert.equal(items.find(item => item.id === 4).payload.status, 'Applied');
  await bulk.click();
  await done(1);
  assert.equal(writes.length, 13);
  assert.equal(await page.locator('.job-card').count(), 2);
  for (const id of [1, 2, 3]) {
    const saved = items.find(item => item.id === id).payload;
    assert.equal(saved.status, 'Unavailable');
    for (const field of ['notes', 'date', 'source', 'jobId', 'url']) assert.equal(saved[field], originals.get(id)[field]);
  }
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^12 results on this page$/ }).waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  await header.check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The expanded toolbar wraps on small screens');
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 12);
  await bulk.press('Enter');
  await page.locator('[data-job-count]').filter({ hasText: /^0 results on this page$/ }).waitFor();
  await done(12);
  assert.equal(await page.locator('.google-job-card').count(), 0);
  assert.equal(await page.locator('[data-job-selection-actions]').isVisible(), false);
  assert.equal(await bulk.isDisabled(), true);
  for (const row of google) assert.equal(items.filter(item => item.payload.url === row.url).length, 1, 'Existing Google tracker rows are reused');
  for (let index = 0; index < 12; index++) {
    const item = items.find(item => item.id === 900 + index);
    assert.equal(item.payload.status, 'Unavailable');
    assert.equal(item.payload.notes, originals.get(item.id).notes);
  }
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^0 results on this page$/ }).waitFor();
  await page.evaluate(() => window.redrawBulkUnavailable());
  assert.equal(await page.locator('.google-job-card').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: current-page bulk unavailable on feeds and all 12 Google cards, busy/duplicate guards, partial failure and retry, metadata, success modal, persistence/redraw, counts, keyboard and 320px toolbar.');
} finally {
  release?.();
  await browser?.close();
  await unlink(preview);
}
