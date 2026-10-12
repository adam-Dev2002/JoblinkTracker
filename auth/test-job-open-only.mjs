import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const preview = new URL('../jobfinder/preview/pages/playground-open-jobs-test.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Open jobs" description="Only open listings" />
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
  const statuses = new Map(google.map((result, index) => [result.url, index < 2 ? 'open' : index === 2 ? 'closed' : 'unknown']));
  let hold = null, release;
  await context.route('**/api/jobs/availability', async route => {
    const input = route.request().postDataJSON();
    checks.push(input);
    const snapshot = input.urls.map(url => ({ url, status: statuses.get(url) || 'open' }));
    if (hold) await hold;
    return route.fulfill({ json: { jobs: snapshot } });
  });
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
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card').count(), 2);
  await page.locator('[data-job-select-all]').check();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^2 selected/);
  await page.locator('[data-job-select-all]').uncheck();
  hold = new Promise(resolve => { release = resolve; });
  await page.locator('#job-source').selectOption('google');
  await page.getByText('Checking which jobs are still open…', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 0, 'Unchecked Google listings never appear as open cards');
  release(); hold = null;
  await page.locator('[data-job-count]').filter({ hasText: /^2 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 2);
  assert.match(await page.locator('[data-google-page-count]').innerText(), /Showing 2 entries/);
  assert.match(await page.locator('[data-job-availability-message]').innerText(), /could not confirm/);
  assert.equal(checks[0].urls.includes(job(14).url), false, 'Known-closed search snippets are discarded before network checks');
  // A listing that fills after display is checked again before opening/tracking.
  statuses.set(job(10).url, 'closed');
  const popupPromise = page.waitForEvent('popup');
  await page.locator('.google-job-card').filter({ hasText: 'Google Assistant 10' }).locator('[data-apply-job]').click();
  const popup = await popupPromise;
  await page.locator('[data-workspace-error]').filter({ hasText: 'closed or filled' }).waitFor();
  assert.equal(popup.isClosed(), true);
  assert.equal(writes.length, 0);
  assert.equal(await page.locator('.google-job-card').count(), 1);
  assert.equal(checks.at(-1).fresh, true);
  await page.locator('.google-job-card [data-job-pick]').check();
  statuses.set(job(11).url, 'closed');
  await page.locator('[data-job-bulk-save]').click();
  await page.locator('[data-job-bulk-status]').filter({ hasText: '1 closed or unverified listings skipped' }).waitFor();
  assert.equal(writes.length, 0, 'Bulk save does not track a newly closed listing');
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/);
  assert.equal(await page.locator('.google-job-card').count(), 0);
  // A late response cannot repaint a different source's results.
  statuses.set(job(10).url, 'open');
  hold = new Promise(resolve => { release = resolve; });
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await page.getByText('Checking which jobs are still open…', { exact: true }).first().waitFor();
  await page.locator('#job-source').selectOption('all');
  release(); hold = null;
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  assert.equal(await page.locator('[data-google-jobs]').isVisible(), false);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card').count(), 2, 'Cached feeds retain closure and expiry filtering');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: feed closure/expiry filtering, Google checks before display, hidden unknown pages, accurate counts, fresh Apply/bulk checks, selection pruning, late-response safety, cache and mobile.');
} finally {
  await browser?.close();
  await unlink(preview);
}
