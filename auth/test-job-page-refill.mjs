import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Actual search UI and provider paging, with isolated APIs and no account writes.
const preview = new URL('../jobfinder/preview/pages/playground-job-page-refill.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Page refill" description="Remaining job pagination" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => {
      if (delay === 15000 && typeof handler === 'function') window.expireRefill = () => handler(...args);
      return schedule(handler, delay, ...args);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], items = [];
  let failTitle = '';
  page.on('pageerror', error => errors.push(error.message));
  const feeds = Array.from({ length: 25 }, (_, index) => ({ id: 'feed-' + index, title: 'Feed Developer ' + index, company: 'Fixture company', location: 'Remote', employmentType: 'Full-time', role: 'Development & IT', url: 'https://example.com/jobs/' + index, source: 'Fixture feed', salary: '', date: new Date().toISOString(), logo: '', workMode: 'Remote', description: 'Developer role.', direct: false }));
  const google = Array.from({ length: 35 }, (_, index) => ({ title: 'Developer ' + index, url: 'https://www.onlinejobs.ph/jobseekers/job/developer-' + (70000 + index), content: 'Remote full-time developer in Manila.' }));
  const providerPages = [google.slice(0, 12), [{ ...google[11], title: 'Developer 11 with edited title', url: 'https://onlinejobs.ph/jobseekers/job/changed-title-70011?utm_source=search' }, ...google.slice(12, 23)], google.slice(23)];
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Refill fixture', email: 'refill@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: new URL(route.request().url()).searchParams.get('q')?.includes('unavailable-unicorn') ? [] : feeds, message: 'Fixture feed' } }));
  await context.route('**/api/workspace/items', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    const input = route.request().postDataJSON();
    if (input.payload.title === failTitle) { failTitle = ''; return route.fulfill({ status: 503, json: { error: 'Fixture save failed. Retry.' } }); }
    let item = items.find(item => item.id === input.id);
    if (item) item.payload = input.payload;
    else { item = { id: 100 + items.length, kind: 'application', payload: input.payload }; items.push(item); }
    return route.fulfill({ json: { item } });
  });
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let host, organic, query;
    const pages = ${JSON.stringify(providerPages)};
    window.providerRequests = [];
    window.pendingProviderPages = [];
    const draw = (page, value) => {
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', value, [], value.includes('unavailable-unicorn') ? [] : pages[page - 1], organic);
      window.__gcse.searchCallbacks.web.rendered();
      host.querySelector('.gsc-cursor-box')?.remove();
      const footer = document.createElement('div');
      footer.className = 'gsc-cursor-box';
      footer.innerHTML = '<div class="gsc-cursor">' + [1,2,3].map(number => '<div role="button" tabindex="0" class="gsc-cursor-page ' + (number === page ? 'gsc-cursor-current-page' : '') + '">' + number + '</div>').join('') + '</div>';
      host.querySelector('.gsc-results').insertBefore(footer, host.querySelector('.gcsc-more-maybe-branding-root'));
      footer.querySelectorAll('.gsc-cursor-page').forEach(control => control.onclick = () => requestPage(Number(control.textContent)));
    };
    const requestPage = page => {
      window.providerRequests.push(page);
      window.__gcse.searchCallbacks.web.starting('joblink-google-jobs', query);
      if (window.holdProviderPages && page > 1) window.pendingProviderPages.push({ page, query });
      else draw(page, query);
    };
    window.flushProviderPages = () => { window.holdProviderPages = false; for (const pending of window.pendingProviderPages.splice(0)) draw(pending.page, pending.query); };
    const element = { execute(value) { query = value; requestPage(1); }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      host = config.div;
      host.innerHTML = '<div class="gsc-control-cse"><div class="gsc-results gsc-webResult"><div data-organic></div><div class="gcsc-more-maybe-branding-root">Enhanced by Google (fixture)</div></div></div>';
      organic = host.querySelector('[data-organic]');
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  const card = title => page.locator('.job-card').filter({ has: page.getByRole('button', { name: title, exact: true }) });
  const ready = async count => {
    await page.waitForFunction(count => document.querySelectorAll('.google-job-card').length === count && document.querySelector('[data-google-jobs]').getAttribute('aria-busy') === 'false', count);
  };
  const closeSuccess = async () => {
    await page.locator('[data-removal-success-modal]').waitFor();
    await page.locator('[data-removal-success-close]').click();
  };
  const markPage = async status => {
    await page.locator('[data-job-select-all]').check();
    await page.locator(status === 'Unavailable' ? '[data-job-bulk-unavailable]' : '[data-job-bulk-apply]').click();
    await page.locator('[data-job-selection-toolbar][aria-busy="false"]').waitFor({ state: 'attached' });
    if (status === 'Unavailable') await closeSuccess();
  };
  await page.goto('/playground-job-page-refill');
  await page.locator('[data-ready=true]').waitFor();
  await card('Feed Developer 0').locator('[data-mark-applied-job]').click();
  await card('Feed Developer 12').waitFor();
  assert.equal(await page.locator('[data-job-results] .job-card').count(), 12);
  await card('Feed Developer 1').locator('[data-mark-unavailable-job]').click();
  await closeSuccess();
  await card('Feed Developer 13').waitFor();
  await page.locator('[data-job-pagination]').getByRole('button', { name: 'Page 2', exact: true }).click();
  assert.equal(await page.locator('[data-job-results] .job-card').count(), 11);
  await markPage('Unavailable');
  await card('Feed Developer 2').waitFor();
  assert.equal(await page.locator('[data-job-results] .job-card').count(), 12, 'An emptied last feed page falls back to remaining jobs');
  await markPage('Applied');
  await page.locator('[data-job-empty]').waitFor();

  await page.locator('#job-source').selectOption('google');
  await ready(12);
  failTitle = 'Developer 0';
  await card('Developer 0').locator('[data-mark-applied-job]').click();
  await page.locator('[data-workspace-error]:not(.d-none)').waitFor();
  assert.equal(await card('Developer 0').count(), 1, 'A failed save retains its job');
  assert.deepEqual(await page.evaluate(() => window.providerRequests), [1], 'Failed saves do not advance provider pages');
  await page.evaluate(() => { window.holdProviderPages = true; });
  await card('Developer 0').locator('[data-mark-applied-job]').click();
  await page.waitForFunction(() => window.pendingProviderPages.length === 1);
  assert.equal(await page.locator('.google-job-card').count(), 11);
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false, 'A pending refill is not an empty search');
  await page.evaluate(() => window.expireRefill());
  await page.locator('[data-google-jobs-status]:not(.visually-hidden)').waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 11, 'A failed later-page load retains already available jobs');
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false, 'A load failure is not reported as exhausted results');
  await page.evaluate(() => window.flushProviderPages());
  await ready(12);
  assert.deepEqual(await page.locator('.google-job-card .job-title-link').allTextContents(), google.slice(1, 13).map(job => job.title), 'Later jobs fill removed slots without duplicate posting IDs');
  await page.locator('[data-google-packed-pages]').getByRole('button', { name: 'Next page', exact: true }).click();
  await ready(12);
  assert.deepEqual(await page.locator('.google-job-card .job-title-link').allTextContents(), google.slice(13, 25).map(job => job.title), 'Next uses the remaining pool and retrieves enough later jobs');
  assert.deepEqual(await page.evaluate(() => window.providerRequests), [1, 2, 3]);
  await page.locator('[data-google-packed-pages]').getByRole('button', { name: 'Previous page', exact: true }).click();
  await ready(12);
  await page.locator('[data-google-packed-pages]').getByRole('button', { name: 'Next page', exact: true }).click();
  await ready(12);
  assert.deepEqual(await page.evaluate(() => window.providerRequests), [1, 2, 3], 'Loaded pages are reused without additional searches');
  await markPage('Unavailable');
  await ready(10);
  assert.deepEqual(await page.locator('.google-job-card .job-title-link').allTextContents(), google.slice(25).map(job => job.title), 'Page three moves forward after a bulk removal');
  await markPage('Applied');
  await ready(12);
  assert.equal(await page.locator('[data-google-packed-pages] [aria-current="page"]').innerText(), '1', 'An emptied last Google page falls back to available jobs');
  await markPage('Applied');
  await ready(0);
  await page.locator('[data-job-empty]').waitFor();
  assert.equal(await page.locator('[data-job-empty]').innerText(), 'No results');
  assert.equal(await page.locator('[data-job-selection-toolbar]').isVisible(), false);
  assert.equal(await page.locator('.gsc-cursor-box').isVisible(), false);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await ready(0);
  await page.locator('[data-job-empty]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.providerRequests), [1, 2, 3], 'Hidden pages are scanned once before confirming exhaustion');

  items.find(item => item.payload.title === 'Developer 4').payload.status = 'Saved';
  items.find(item => item.payload.title === 'Feed Developer 2').payload.status = 'Saved';
  await page.reload();
  await ready(1);
  assert.equal(await card('Developer 4').count(), 1, 'Restoring Saved makes the job available again');
  await page.locator('#job-source').selectOption('all');
  await page.locator('#job-query').fill('developer');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await ready(1);
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  const positions = await page.locator('.job-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
  assert.ok(Math.abs(positions[0] - positions[1]) < 2, 'Feed and refilled Google jobs share a row');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  for (const item of items) if (item.payload.title.startsWith('Developer ')) item.payload.status = 'Saved';
  await page.reload();
  await ready(12);
  await page.evaluate(() => { window.holdProviderPages = true; });
  await card('Developer 0').locator('[data-mark-applied-job]').click();
  await page.waitForFunction(() => window.pendingProviderPages.length === 1);
  await page.locator('#job-query').fill('unavailable-unicorn-role');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await page.locator('[data-job-empty]').waitFor();
  await page.evaluate(() => window.flushProviderPages());
  assert.equal(await page.locator('.job-card').count(), 0, 'A previous refill cannot overwrite a new search');
  assert.deepEqual(errors, []);
  console.log('PASS: individual/bulk status refills, failed saves and loads, native-page loading, deduplication, compact pages, cached navigation, last-page fallback, exhaustion, reload, restoration, mixed-source rows, mobile and stale refill cancellation.');
} finally {
  await browser?.close();
  await unlink(preview);
}
