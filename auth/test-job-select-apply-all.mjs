import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';
import { mockOpenAvailability } from './job-availability-fixture.mjs';

const preview = new URL('../jobfinder/preview/pages/playground-select-apply-all.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Select and apply all" description="All matching jobs" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await mockOpenAvailability(context);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  const jobs = Array.from({ length: 218 }, (_, index) => ({ id: `all-${index}`, title: `Assistant ${index}`, company: 'Acme', location: index % 2 ? 'USA' : 'Manila', employmentType: 'Full-time', role: 'Virtual assistance', url: `https://example.com/jobs/${index}`, source: 'Test feed', availability: 'open', salary: '', date: '', logo: 'https://example.com/logo.svg', workMode: 'Remote / WFH', description: 'Assistant job', direct: false }));
  const google = Array.from({ length: 12 }, (_, index) => ({ title: `Google Assistant ${index + 1}`, url: `https://www.onlinejobs.ph/jobseekers/job/new-assistant-${index + 1}`, content: 'Assistant job' }));
  const entry = (index, status) => ({ id: index + 1, kind: 'application', payload: { ...jobs[index], jobId: jobs[index].id, status, date: '2026-10-12', notes: `Personal note ${index}` } });
  const items = [entry(0, 'Saved'), entry(1, 'Application opened'), entry(2, 'Saved'), entry(217, 'Applied'),
    ...google.map((job, index) => ({ id: 900 + index, kind: 'application', payload: { ...job, company: '', salary: '', date: '2026-10-12', notes: `Google note ${index}`, jobId: `previously-tracked-google-${index}`, source: 'Google · www.onlinejobs.ph', status: index % 2 ? 'Saved' : 'Application opened' } })),
  ];
  let failOnce = true, release;
  const hold = new Promise(resolve => { release = resolve; });
  let held = false;
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'All jobs preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Test feed', configured: true } }));
  await context.route('**/api/workspace/items', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    const input = route.request().postDataJSON();
    writes.push(input);
    assert.equal(input.payload.status, 'Applied');
    assert.equal(route.request().headers()['x-csrf-token'], 'fixture');
    if (!held) { held = true; await hold; }
    if (input.payload.jobId === 'all-2' && failOnce) {
      failOnce = false;
      return route.fulfill({ status: 503, json: { error: 'Apply failed once. Retry.' } });
    }
    let item = items.find(item => item.id === input.id);
    if (item) item.payload = input.payload;
    else { item = { id: 1000 + writes.length, kind: 'application', payload: input.payload }; items.push(item); }
    return route.fulfill({ json: { item } });
  });
  await context.route('https://example.com/logo.svg', route => route.abort());
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(google)}, organic);
      window.__gcse.searchCallbacks.web.rendered();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      config.div.innerHTML='<div data-organic></div>'; organic=config.div.firstElementChild;
      config.div.addEventListener('click', event => event.stopPropagation());
      config.div.addEventListener('change', event => event.stopPropagation());
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  await page.goto('/playground-select-apply-all');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^217 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card [data-mark-applied-job]').count(), 12, 'All cards offer Applied, including saved, opened and untouched jobs');
  const bulk = page.locator('[data-job-select-all]');
  await bulk.check();
  assert.equal(await page.locator('[data-job-selection-label]').innerText(), 'Deselect 217 jobs');
  assert.equal(await page.locator('[data-job-selected-count]').innerText(), '217 selected');
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 12);
  assert.equal(await page.locator('[data-job-pick="all-0"]').isChecked(), true, 'Saved jobs are selected');
  assert.equal(await page.locator('[data-job-pick="all-1"]').isChecked(), true, 'Previously opened jobs are selected');
  await page.getByRole('button', { name: 'Page 19', exact: true }).click();
  assert.equal(await page.locator('[data-job-pick="all-216"]').isChecked(), true, 'Selection covers the last page beyond the former cap');
  await bulk.uncheck();
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 0);
  await bulk.check();
  await page.locator('#job-location').fill('No results');
  assert.equal(await bulk.isEnabled(), true);
  await bulk.uncheck();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/);
  await page.locator('#job-location').fill('');
  await bulk.check();
  const downloadReady = page.waitForEvent('download');
  await page.locator('[data-job-bulk-export]').click();
  const download = await downloadReady;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString('utf8').trim().split('\r\n').length, 218, 'Export includes all 217 selected jobs');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('[data-job-bulk-apply]').click();
  await page.locator('[data-job-selection-toolbar][aria-busy=true]').waitFor();
  assert.equal(await bulk.isDisabled(), true);
  assert.equal(await page.locator('[data-job-bulk-apply]').isDisabled(), true);
  assert.equal(await page.locator('[data-job-pick]').first().isDisabled(), true);
  release();
  await page.locator('[data-job-bulk-status]').filter({ hasText: '216 jobs marked as applied' }).waitFor({ timeout: 60000 });
  assert.equal(writes.length, 217, 'The action attempts every selected job');
  assert.equal(items.length, 230, 'Existing saved and opened records are updated without duplicates');
  assert.equal(items.find(item => item.id === 1).payload.notes, 'Personal note 0');
  assert.equal(items.find(item => item.id === 2).payload.logo, jobs[1].logo);
  assert.equal(items.find(item => item.id === 3).payload.status, 'Saved');
  assert.equal(await page.locator('.job-card').count(), 1, 'Successful confirmations disappear, while failed ones remain');
  assert.equal(await page.locator('[data-job-pick="all-2"]').isChecked(), true);
  await page.locator('[data-job-bulk-apply]').click();
  await page.locator('[data-job-bulk-status]').filter({ hasText: '1 job marked as applied' }).waitFor();
  assert.equal(writes.length, 218);
  assert.equal(items.length, 230);
  assert.equal(items.filter(item => !item.payload.url.includes('onlinejobs.ph')).every(item => item.payload.status === 'Applied'), true);
  assert.equal(await page.locator('.job-card').count(), 0);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^0 results$/ }).waitFor();
  // Reproduce the screenshot: the previously opened card must be included with
  // all other Google results, regardless of its tracker ID or existing status.
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^12 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card [data-mark-applied-job]').count(), 12);
  assert.equal(await bulk.isEnabled(), true, 'Select all remains available when every Google card is already saved or opened');
  await bulk.check();
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 12, 'Bulk selection includes the previously opened and saved Google cards');
  assert.equal(await page.locator('[data-job-selection-label]').innerText(), 'Deselect 12 jobs');
  await bulk.uncheck();
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 0);
  await page.locator('.google-job-card [data-mark-applied-job]').first().press('Space');
  await page.locator('[data-job-count]').filter({ hasText: /^11 results on this page$/ }).waitFor();
  assert.equal(items.find(item => item.id === 900).payload.status, 'Applied');
  assert.equal(items.find(item => item.id === 900).payload.notes, 'Google note 0');
  assert.equal(items.filter(item => item.payload.url === google[0].url).length, 1);
  await bulk.check();
  assert.equal(await page.locator('.google-job-card [data-job-pick]:checked').count(), 11);
  await page.locator('[data-job-bulk-apply]').click();
  await page.locator('[data-job-count]').filter({ hasText: /^0 results on this page$/ }).waitFor();
  assert.equal(items.length, 230);
  assert.equal(items.find(item => item.id === 901).payload.status, 'Applied');
  assert.equal(items.find(item => item.id === 901).payload.notes, 'Google note 1');
  assert.equal(items.every(item => item.payload.status === 'Applied'), true);
  assert.deepEqual(errors, []);
  console.log('PASS: select/deselect all 217 feed jobs and all 12 Google cards including previously opened/saved cards, full export, bulk Applied, preserved notes/logos, failed-row retry, persistence, keyboard confirmation and mobile.');
} finally {
  await browser?.close();
  await unlink(preview);
}
