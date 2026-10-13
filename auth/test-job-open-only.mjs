import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const preview = new URL('../jobfinder/preview/pages/playground-open-jobs-test.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Open jobs" description="Listings without scans" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], checks = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  const job = (index, overrides = {}) => ({ id: `open-${index}`, title: `Assistant ${index}`, company: 'Acme', location: 'Manila', employmentType: 'Full-time', role: 'Virtual assistance', url: `https://www.onlinejobs.ph/jobseekers/job/assistant-${index}`, source: 'Test feed', availability: 'open', salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Work with customers', direct: false, ...overrides });
  const jobs = [job(1), job(2, { title: 'Full-time Full Stack Developer' }), job(3, { availability: 'closed' }), job(4, { title: '[FILLED] Assistant' }), job(5, { validThrough: '2000-01-01' }), job(6, { description: 'This job has been closed.' }), job(7, { availability: 'unknown' })];
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Open jobs preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { item: { id: 1, kind: 'application', payload: route.request().postDataJSON().payload } } });
  });
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Test feed', configured: true } }));
  const google = [10, 11, 12, 13, 14].map(index => ({ title: index === 14 ? '[Closed] Old job' : `Google Assistant ${index}`, url: job(index).url, content: 'Assistant job' }));
  await context.route('**/api/jobs/availability', route => {
    checks.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'Scanner unavailable' } });
  });
  await context.route('https://www.onlinejobs.ph/jobseekers/job/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Original listing</h1>' }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(google)}, organic);
      window.__gcse.searchCallbacks.web.rendered();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div class="gsc-cursor-page gsc-cursor-current-page">1</div></div></div></div>';
      organic = config.div.querySelector('[data-organic]');
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  await page.goto('/playground-open-jobs-test');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^3 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card').count(), 3);
  await page.locator('[data-job-select-all]').check();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^3 selected/);
  await page.locator('[data-job-select-all]').uncheck();
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^4 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 4);
  assert.match(await page.locator('[data-google-page-count]').innerText(), /Showing 4 entries/);
  assert.equal(await page.locator('[data-job-availability-message], [data-retry-job-availability]').count(), 0);
  assert.deepEqual(checks, [], 'Results display without network availability checks');
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^4 results on this page$/ }).waitFor();
  assert.deepEqual(checks, [], 'Cached Google previews never trigger a scan');
  const popupPromise = page.waitForEvent('popup');
  await page.locator('.google-job-card').filter({ hasText: 'Google Assistant 10' }).locator('[data-apply-job]').click();
  const popup = await popupPromise;
  await popup.waitForURL(job(10).url);
  assert.equal(writes[0].action, 'open-application');
  assert.deepEqual(checks, [], 'Apply opens without a scan');
  await popup.close();
  assert.equal(await page.locator('[data-application-modal], .modal-backdrop').count(), 0, 'Opening a listing does not interrupt the page');
  await page.locator('[data-job-select-all]').check();
  await page.locator('[data-job-bulk-save]').click();
  await page.locator('[data-job-bulk-status]').filter({ hasText: '3 jobs saved. 1 already in your tracker.' }).waitFor();
  assert.equal(writes.length, 4);
  assert.deepEqual(checks, [], 'Bulk Save never scans listings');
  await page.locator('#job-source').selectOption('all');
  await page.locator('[data-job-count]').filter({ hasText: /^3 results$/ }).waitFor();
  assert.equal(await page.locator('[data-google-jobs]').isVisible(), false);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^3 results$/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(checks, []);
  console.log('PASS: scan-free Google display, cached previews, Apply, bulk Save, local closure filtering, unknown feed visibility, selection, counts and mobile.');
} finally {
  await browser?.close();
  await unlink(preview);
}
