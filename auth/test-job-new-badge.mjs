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
  }, initialTime);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const job = (id, date = '', url = `https://example.com/jobs/${id}`) => ({ id, title: `Assistant ${id}`, company: 'Fixture company', location: 'Manila',
    employmentType: 'Full-time', role: 'Virtual assistance', url, source: 'Fixture feed', salary: '', date, logo: '', workMode: 'Remote / WFH', description: 'Assistant job', direct: false });
  const knownGoogle = job('known-google', '', 'https://www.onlinejobs.ph/jobseekers/job/known-assistant-123');
  const recent = job('recent', new Date(initialTime - 60 * 60 * 1000).toISOString());
  const old = job('old', new Date(initialTime - 10 * 86400000).toISOString());
  const future = job('future', new Date(initialTime + 86400000).toISOString());
  const jobs = [recent, old, knownGoogle, future];
  const added = job('added');
  let googleResults = [knownGoogle, job('google-baseline', '', 'https://www.onlinejobs.ph/jobseekers/job/baseline-assistant-456')];
  const addedGoogle = job('google-added', '', 'https://www.onlinejobs.ph/jobseekers/job/new-assistant-789');
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'New badge fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Fixture feed' } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic, query;
    window.drawNewBadgeGoogle = rows => {
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], rows, organic);
      window.__gcse.searchCallbacks.web.rendered();
    };
    const element = { execute(value) { query = value; window.drawNewBadgeGoogle(${JSON.stringify(googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })))}); }, clearAllResults() {} };
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
  assert.equal(await page.locator('[data-job-new]').count(), 1);
  assert.equal(await card(recent.id).locator('[data-job-new]').innerText(), 'New');
  assert.match(await card(recent.id).locator('[data-job-new]').getAttribute('title'), /Posted/);
  assert.equal(await card(old.id).locator('[data-job-new]').count(), 0);
  assert.equal(await card(knownGoogle.id).locator('[data-job-new]').count(), 0);
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
  await page.locator('[data-job-count]').filter({ hasText: /^2 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card [data-job-new]').count(), 0);
  googleResults = [...googleResults, addedGoogle];
  await page.evaluate(rows => window.drawNewBadgeGoogle(rows), googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })));
  await page.locator('[data-job-count]').filter({ hasText: /^3 results on this page$/ }).waitFor();
  const googleCard = page.locator('.google-job-card').filter({ hasText: addedGoogle.title });
  await googleCard.locator('[data-job-new]').waitFor();
  assert.equal(await page.locator('.google-job-card [data-job-new]').count(), 1);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await googleCard.locator('[data-job-new]').waitFor();
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
  await page.evaluate(() => { window.badgeTime += 49 * 60 * 60 * 1000; });
  await page.locator('[data-job-select-all]').check();
  await page.locator('[data-job-select-all]').uncheck();
  await page.evaluate(rows => window.drawNewBadgeGoogle(rows), googleResults.map(row => ({ title: row.title, url: row.url, content: row.description })));
  await page.locator('[data-job-count]').filter({ hasText: /^3 results on this page$/ }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.google-job-card [data-job-new]').length === 0);
  assert.deepEqual(errors, []);
  console.log('PASS: green New pill above sources, real publication recency, feed/Google discovery baselines and arrivals, persistence, zero redraw writes, 48-hour expiry, dark theme and 320px layout.');
} finally {
  await browser?.close();
  await unlink(preview);
}
