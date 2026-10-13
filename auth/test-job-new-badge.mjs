import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const preview = new URL('../jobfinder/preview/pages/playground-new-job-badge.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="New job badge" description="Recent posting and discovery badge" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const initialTime = Date.now();
  await context.addInitScript(time => {
    window.badgeTime = Number(sessionStorage.getItem('new-badge-test-time')) || time;
    Date.now = () => window.badgeTime;
    window.discoveryWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('joblink-job-discovery-v1:')) window.discoveryWrites++;
      return original.call(this, key, value);
    };
    if (!localStorage.getItem('joblink-job-discovery-v1:1')) localStorage.setItem('joblink-job-discovery-v1:1', JSON.stringify({ owner: 1, channels: ['google:previous-filter'], entries: [
      ['url:https://www.onlinejobs.ph/jobseekers/job/known-assistant-123', { detectedAt: time - 60 * 60 * 1000 }],
      ['url:https://www.onlinejobs.ph/jobseekers/job/expired-assistant-999', { detectedAt: time - 72 * 60 * 60 * 1000 }],
    ] }));
  }, initialTime);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const job = (id, date = '', url = `https://example.com/jobs/${id}`) => ({ id, title: `Assistant ${id}`, company: 'Fixture company', location: 'Manila',
    employmentType: 'Full-time', role: 'Virtual assistance', url, source: 'Fixture feed', salary: '', date, logo: '', workMode: 'Remote / WFH', description: 'Assistant job in Manila, Philippines.', direct: false });
  const knownGoogle = job('known-google', '', 'https://www.onlinejobs.ph/jobseekers/job/known-assistant-123');
  const recent = job('recent', new Date(initialTime - 60 * 60 * 1000).toISOString());
  const old = job('old', new Date(initialTime - 10 * 86400000).toISOString());
  const future = job('future', new Date(initialTime + 86400000).toISOString());
  const jobs = [recent, old, knownGoogle, future];
  const added = job('added');
  const expiredGoogle = job('google-expired', '', 'https://www.onlinejobs.ph/jobseekers/job/expired-assistant-999');
  let googleResults = [knownGoogle, job('google-baseline', '', 'https://www.onlinejobs.ph/jobseekers/job/baseline-assistant-456'), expiredGoogle];
  const addedGoogle = job('google-added', '', 'https://www.onlinejobs.ph/jobseekers/job/new-assistant-789');
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'New badge fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Fixture feed' } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic, query;
    window.badgeGoogleRows = ${JSON.stringify(googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })))};
    window.drawNewBadgeGoogle = rows => {
      window.badgeGoogleRows = rows;
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], rows, organic);
      window.__gcse.searchCallbacks.web.rendered();
    };
    const element = { execute(value) { query = value; window.badgeGoogleSearches = (window.badgeGoogleSearches || 0) + 1; window.drawNewBadgeGoogle(window.badgeGoogleRows); }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div></div>';
      organic = config.div.querySelector('[data-organic]');
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  const card = id => page.locator(`[data-job-card="${id}"]`);
  await page.goto('/playground-new-job-badge');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^4 results$/ }).waitFor();
  assert.equal(await page.locator('[data-job-new]').count(), 2);
  assert.equal(await card(recent.id).locator('[data-job-new]').innerText(), 'New');
  assert.match(await card(recent.id).locator('[data-job-new]').getAttribute('title'), /Posted/);
  assert.equal(await card(old.id).locator('[data-job-new]').count(), 0);
  assert.equal(await card(knownGoogle.id).locator('[data-job-new]').count(), 1, 'A recently detected legacy job gains its previously suppressed badge');
  assert.equal(await card(future.id).locator('[data-job-new]').count(), 0);
  const writes = await page.evaluate(() => window.discoveryWrites);
  await page.locator('[data-job-select-all]').check();
  await page.locator('[data-job-select-all]').uncheck();
  await page.locator('#job-location').fill('Manila');
  assert.equal(await page.evaluate(() => window.discoveryWrites), writes, 'Selection/filter redraws do not persist or renew discovery');
  jobs.push(added, job('old-arrival', old.date));
  await page.evaluate(() => { window.badgeTime += 6 * 60000; sessionStorage.setItem('new-badge-test-time', String(window.badgeTime)); document.querySelector('[data-job-search]').requestSubmit(); });
  await page.locator('[data-job-count]').filter({ hasText: /^6 results$/ }).waitFor();
  assert.match(await card(added.id).locator('[data-job-new]').getAttribute('title'), /Newly discovered/);
  assert.equal(await card('old-arrival').locator('[data-job-new]').count(), 0);
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^3 results$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card [data-job-new]').count(), 2, 'New applies immediately to the first results, including undated Google jobs');
  assert.equal(await page.locator('.google-job-card').filter({ hasText: expiredGoogle.title }).locator('[data-job-new]').count(), 0);
  googleResults = [...googleResults, addedGoogle];
  await page.evaluate(rows => window.drawNewBadgeGoogle(rows), googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })));
  await page.locator('[data-job-count]').filter({ hasText: /^4 results$/ }).waitFor();
  const googleCard = page.locator('.google-job-card').filter({ hasText: addedGoogle.title });
  await googleCard.locator('[data-job-new]').waitFor();
  assert.equal(await page.locator('.google-job-card [data-job-new]').count(), 3);
  const originalDetection = await page.evaluate(url => JSON.parse(localStorage.getItem('joblink-job-discovery-v1:1')).entries.find(([key]) => key === 'url:' + url)[1].detectedAt, addedGoogle.url);
  const assertGoogleBadges = async () => {
    await page.waitForFunction(total => document.querySelectorAll('.google-job-card').length === total && document.querySelectorAll('.google-job-card [data-job-new]').length === total - 1, googleResults.length);
    assert.equal(await page.locator('.google-job-card').filter({ hasText: expiredGoogle.title }).locator('[data-job-new]').count(), 0, 'Changing filters never renews expired jobs');
  };
  const changeFilter = async (id, value, input = false) => {
    const row = job(`filter-${id}-${googleResults.length}`, '', `https://www.onlinejobs.ph/jobseekers/job/filter-${910000 + googleResults.length}`);
    googleResults.push(row);
    await page.evaluate(rows => { window.badgeGoogleRows = rows; }, googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })));
    const before = await page.evaluate(() => window.badgeGoogleSearches);
    if (input) await page.locator('#' + id).fill(value);
    else await page.locator('#' + id).selectOption(value);
    await page.waitForFunction(before => window.badgeGoogleSearches > before, before);
    await assertGoogleBadges();
    assert.equal(await page.locator('.google-job-card').filter({ hasText: row.title }).locator('[data-job-new]').count(), 1, `First results after ${id} changes receive New`);
  };
  await changeFilter('job-query', 'assistant', true);
  await changeFilter('job-location', 'Philippines', true);
  await changeFilter('job-employment', 'Full-time');
  await changeFilter('job-listing-time', '1');
  await changeFilter('job-classification', 'Virtual assistance');
  await changeFilter('job-source', 'all');
  await changeFilter('job-source', 'google');
  assert.equal(await page.evaluate(url => JSON.parse(localStorage.getItem('joblink-job-discovery-v1:1')).entries.find(([key]) => key === 'url:' + url)[1].detectedAt, addedGoogle.url), originalDetection, 'All filters reuse the original job detection time');
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await googleCard.locator('[data-job-new]').waitFor();
  await assertGoogleBadges();
  await page.setViewportSize({ width: 320, height: 844 });
  const badgeStyle = await googleCard.locator('[data-job-new]').evaluate(badge => {
    const style = getComputedStyle(badge), rect = badge.getBoundingClientRect(), source = badge.parentElement.querySelector('p').getBoundingClientRect();
    return { background: style.backgroundColor, color: style.color, radius: style.borderRadius, dot: getComputedStyle(badge.querySelector('.job-new-dot')).backgroundColor, bottom: rect.bottom, sourceTop: source.top, left: rect.left, right: rect.right };
  });
  assert.equal(badgeStyle.background, 'rgb(228, 247, 232)');
  assert.equal(badgeStyle.color, 'rgb(35, 101, 52)');
  assert.equal(badgeStyle.dot, badgeStyle.color);
  assert.equal(badgeStyle.radius, '8px');
  assert.ok(badgeStyle.bottom <= badgeStyle.sourceTop, 'The badge sits just above the source line');
  assert.ok(badgeStyle.left >= 0 && badgeStyle.right <= 320);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'dark'));
  assert.equal(await googleCard.locator('[data-job-new]').evaluate(badge => getComputedStyle(badge).color), 'rgb(166, 232, 184)');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#job-listing-time').selectOption('');
  await page.locator('#job-location').fill('Manila');
  await page.locator('#job-location').press('Escape');
  const feedSources = await page.locator('#job-source option').evaluateAll(options => options.filter(option => option.value !== 'google' && !option.disabled).map(option => option.value));
  for (const source of feedSources) {
    await page.locator('#job-source').selectOption(source);
    await page.waitForFunction(() => document.querySelector('[data-job-search]').getAttribute('aria-busy') === 'false');
    await card(recent.id).locator('[data-job-new]').waitFor();
    assert.equal(await card(added.id).locator('[data-job-new]').count(), 1, `New stays consistent in the ${source} source`);
  }
  await page.locator('#job-source').selectOption('all');
  jobs.push(...Array.from({ length: 13 }, (_, index) => job('paged-' + index)));
  await page.evaluate(() => { window.badgeTime += 6 * 60000; sessionStorage.setItem('new-badge-test-time', String(window.badgeTime)); document.querySelector('[data-job-search]').requestSubmit(); });
  await page.locator('[data-job-count]').filter({ hasText: new RegExp(`^${18 + googleResults.length} results$`) }).waitFor();
  await page.locator('[data-job-pagination]').getByRole('button', { name: 'Page 2', exact: true }).click();
  assert.equal(await page.locator('[data-job-results] .job-card:not(.google-job-card)').count(), 7);
  assert.equal(await page.locator('[data-job-results] .job-card:not(.google-job-card) [data-job-new]').count(), 7, 'New badges apply on later result pages');
  await page.locator('#job-source').selectOption('google');
  await assertGoogleBadges();
  await page.evaluate(() => { window.badgeTime += 49 * 60 * 60 * 1000; });
  await page.locator('[data-job-select-all]').check();
  await page.locator('[data-job-select-all]').uncheck();
  await page.evaluate(rows => window.drawNewBadgeGoogle(rows), googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })));
  await page.locator('[data-job-count]').filter({ hasText: new RegExp(`^${googleResults.length} results$`) }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.google-job-card [data-job-new]').length === 0);
  assert.deepEqual(errors, []);
  console.log('PASS: immediate New badges across every source/filter, first Google/filtered results, legacy detection migration, later pages, reload/expiry, stable timestamps, zero redraw writes, dark theme and 320px layout.');
} finally {
  await browser?.close();
  await unlink(preview);
}
