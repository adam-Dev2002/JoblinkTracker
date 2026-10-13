import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';
import { loadEnv } from '../jobfinder/node_modules/vite/dist/node/index.js';

for (const [key, value] of Object.entries(loadEnv('development', fileURLToPath(new URL('../jobfinder/preview/', import.meta.url)), ''))) process.env[key] ??= value;
const emails = [0, 1].map(index => `auth-test-unavailable-${Date.now()}-${index}@example.invalid`);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const jobs = Array.from({ length: 3 }, (_, index) => ({
  id: `unavailable-${index}`, title: `Assistant ${index}`, company: 'Fixture company', location: 'Manila',
  employmentType: 'Full-time', role: 'Virtual assistance', url: `https://www.onlinejobs.ph/jobseekers/job/assistant-${998001 + index}`,
  source: 'Test feed', salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Assistant role', direct: false,
}));
const payload = (job, status = 'Unavailable') => ({ ...job, jobId: job.id, status, date: '2026-10-01', notes: 'Personal tracker notes' });
const baseURL = process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000';
const read = async context => (await (await context.request.get('/api/workspace/items')).json()).items;
const errors = [];
let releaseSave;
try {
  async function register(context, email) {
    const session = await (await context.request.get('/api/auth/session')).json();
    const response = await context.request.post('/api/auth/register', { headers: { 'X-CSRF-Token': session.csrf }, data: { name: 'Unavailable test', email, password: 'Unavailable-test-password-2026' } });
    assert.equal(response.status(), 201, await response.text());
    return (await (await context.request.get('/api/auth/session')).json()).csrf;
  }
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const csrf = await register(context, emails[0]);
  const seededResponse = await context.request.post('/api/workspace/items', { headers: { 'X-CSRF-Token': csrf }, data: { kind: 'application', payload: payload(jobs[1], 'Saved') } });
  assert.equal(seededResponse.status(), 200, await seededResponse.text());
  const seeded = (await seededResponse.json()).item;
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Fixture jobs' } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      window.redrawUnavailableGoogle = () => {
        window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(jobs.map(job => ({ title: job.title, url: job.url, content: job.description })))}, organic);
        window.__gcse.searchCallbacks.web.rendered();
      };
      window.redrawUnavailableGoogle();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div class="gsc-cursor-page gsc-cursor-current-page">1</div></div></div></div>';
      organic = config.div.querySelector('[data-organic]');
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  let failNext = true, holdSave = false, unavailableWrites = 0;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  await context.route('**/api/workspace/items', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().payload?.status === 'Unavailable') {
      unavailableWrites++;
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: 'Could not mark unavailable. Retry.' } }); }
      if (holdSave) await saveGate;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const card = index => page.locator(`[data-job-card="${jobs[index].id}"]`);
  const done = async () => {
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-removal-success-message]').innerText(), /marked unavailable/);
    await page.locator('[data-removal-success-close]').click();
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'hidden' });
  };
  await page.goto('/job-listing');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^3 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card [data-mark-unavailable-job]').count(), 3);
  await card(0).locator('[data-job-pick]').check();
  await card(0).locator('[data-mark-unavailable-job]').click();
  await page.locator('[data-workspace-error]').filter({ hasText: 'Could not mark unavailable' }).waitFor();
  assert.equal(await card(0).isVisible(), true);
  assert.equal(await card(0).locator('[data-mark-unavailable-job]').isEnabled(), true);
  assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false);
  assert.equal((await read(context)).some(item => item.payload.jobId === jobs[0].id), false);
  holdSave = true;
  await card(0).locator('[data-mark-unavailable-job]').click();
  assert.equal(await card(0).locator('[data-mark-unavailable-job]').isDisabled(), true);
  assert.equal(await card(0).locator('[data-mark-applied-job]').isDisabled(), true);
  await card(0).locator('[data-mark-unavailable-job]').dispatchEvent('click');
  releaseSave(); holdSave = false;
  await card(0).waitFor({ state: 'detached' });
  await done();
  assert.equal(unavailableWrites, 2, 'Repeated clicks during a save cannot create duplicate records');
  assert.match(await page.locator('[data-job-count]').innerText(), /^2 results$/);
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/);
  const hidden = (await read(context)).filter(item => item.payload.jobId === jobs[0].id);
  assert.equal(hidden.length, 1); assert.equal(hidden[0].payload.status, 'Unavailable');

  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^2 results on this page$/ }).waitFor();
  const googleSaved = page.locator('.google-job-card').filter({ hasText: jobs[1].title });
  await googleSaved.locator('[data-mark-unavailable-job]').press('Enter');
  await googleSaved.waitFor({ state: 'detached' });
  await done();
  const updated = (await read(context)).find(item => item.id === seeded.id);
  assert.equal(updated.payload.status, 'Unavailable');
  for (const key of ['notes', 'date', 'source', 'jobId', 'url']) assert.equal(updated.payload[key], seeded.payload[key], `${key} survives marking unavailable`);
  assert.equal((await read(context)).length, 2);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^1 results on this page$/ }).waitFor();
  await page.evaluate(() => window.redrawUnavailableGoogle());
  assert.equal(await page.locator('.google-job-card').count(), 1, 'Cached previews and provider redraws respect unavailable jobs');

  await page.goto('/applications');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-application-filter-toggle]').click();
  await page.locator('[data-status-filter]').selectOption('Unavailable');
  await page.locator('[data-application-filter-toggle]').click();
  assert.equal(await page.locator('[data-application-rows] tr').count(), 2);
  assert.equal(await page.locator('[data-application-stat="reply"]').innerText(), '0%');
  const restored = page.waitForResponse(response => response.url().includes('/api/workspace/items') && response.request().method() === 'POST');
  await page.locator(`[data-entry-status="${seeded.id}"]`).selectOption('Saved');
  assert.equal((await restored).status(), 200);
  await page.goto('/job-listing');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^2 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card').filter({ hasText: jobs[0].title }).count(), 0);
  await page.locator('#job-source').selectOption('all');
  await card(1).waitFor();
  assert.equal(await card(0).count(), 0, 'Hidden postings stay hidden when switching feeds');
  await page.locator('#job-source').selectOption('google');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCard = page.locator('.google-job-card').filter({ hasText: jobs[2].title });
  const buttonBounds = await mobileCard.locator('[data-mark-unavailable-job]').boundingBox();
  assert.ok(buttonBounds.x >= 0 && buttonBounds.x + buttonBounds.width <= 390);
  await mobileCard.locator('[data-mark-unavailable-job]').press('Space');
  await mobileCard.waitFor({ state: 'detached' });
  await done();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto('/dashboard');
  await page.locator('[data-ready=true]').waitFor();
  assert.equal(await page.locator('[data-stat="applications"]').innerText(), '0', 'Unavailable jobs are never counted as submitted applications');

  const other = await browser.newContext({ baseURL });
  const otherCsrf = await register(other, emails[1]);
  assert.equal((await other.request.post('/api/workspace/items', { headers: { 'X-CSRF-Token': otherCsrf }, data: { id: hidden[0].id, kind: 'application', payload: payload(jobs[0], 'Saved') } })).status(), 404);
  assert.deepEqual(await read(other), [], 'Marking unavailable never changes another account');
  assert.equal((await context.request.post('/api/workspace/items', { data: { id: hidden[0].id, kind: 'application', payload: payload(jobs[0]) } })).status(), 403);
  assert.equal((await context.request.post('/api/workspace/items', { headers: { 'X-CSRF-Token': csrf }, data: { id: hidden[0].id, kind: 'application', payload: payload(jobs[0], 'Invalid status') } })).status(), 422);
  assert.deepEqual(errors, []);
  console.log('PASS: unavailable button on every card, failed-save retry, duplicate prevention, feed/Google hiding and counts, reload persistence, tracker restoration, metadata, keyboard/mobile, CSRF and account isolation.');
} finally {
  releaseSave?.();
  await browser.close();
  if (process.env.JOBLINK_BACKEND === 'supabase') {
    const { db, query } = await import('../jobfinder/preview/server/core.mjs');
    for (const email of emails) await query(db().from('users').delete().eq('email', email));
  } else {
    for (const email of emails) execFileSync('C:/xampp/php/php.exe', [fileURLToPath(new URL('./test-account.php', import.meta.url)), email, 'cleanup']);
  }
}
