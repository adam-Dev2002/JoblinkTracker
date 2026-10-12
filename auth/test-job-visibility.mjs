import assert from 'node:assert/strict';
import { mockOpenAvailability } from './job-availability-fixture.mjs';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Real UI with mocked storage and Google results; no account or database writes.
const previews = ['jobs', 'applications'].map(view => new URL(`../jobfinder/preview/pages/playground-visibility-${view}.astro`, import.meta.url));
const created = [];
let browser;
try {
  for (const [index, preview] of previews.entries()) {
    await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="${index ? 'applications' : 'jobs'}" title="Job visibility preview" description="Application visibility regression" />
`, { flag: 'wx' });
    created.push(preview);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await mockOpenAvailability(context);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const jobs = Array.from({ length: 15 }, (_, index) => ({
    id: `visibility-${index}`, title: `Assistant ${index}`, company: 'Example company', location: 'Manila',
    employmentType: 'Full-time', role: 'Virtual assistance', url: `https://www.onlinejobs.ph/jobseekers/job/assistant-${index}`,
    source: 'Test feed', salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Assistant role', direct: false,
  }));
  const entry = (index, status, overrides = {}) => ({ id: index + 1, kind: 'application', payload: {
    ...jobs[index], jobId: jobs[index].id, status, notes: '', time: '', value: '', ...overrides,
  } });
  let items = [entry(0, 'Applied'), entry(1, 'Interview'), entry(2, 'Offer'), entry(3, 'Rejected'), entry(4, 'Ghosted'), entry(5, 'Application opened'), entry(6, 'Saved')];
  // Same job ID/source still matches when its source URL changes.
  items[0].payload.url += '?old=1';
  // URL matching also suppresses a different feed's copy of an applied job.
  jobs.push({ ...jobs[1], id: 'duplicate-interview', source: 'Other feed' });
  let failSave = false;
  let posts = 0;
  let workspaceGate;
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Visibility preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', async route => {
    if (route.request().method() !== 'POST') {
      if (workspaceGate) await workspaceGate;
      return route.fulfill({ json: { items } });
    }
    posts++;
    const input = route.request().postDataJSON();
    if (failSave) {
      failSave = false;
      return route.fulfill({ status: 503, json: { error: 'Could not save. Retry.' } });
    }
    let item = items.find(item => item.id === input.id || item.payload.url === input.payload.url);
    if (input.action === 'open-application') {
      if (!item) { item = { id: 100 + posts, kind: 'application', payload: input.payload }; items.push(item); }
      else if (item.payload.status === 'Saved') item.payload.status = 'Application opened';
    } else if (item) item.payload = input.payload;
    else { item = { id: 100 + posts, kind: 'application', payload: input.payload }; items.push(item); }
    await route.fulfill({ json: { item } });
  });
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Test feed', configured: true } }));
  await context.route('https://www.onlinejobs.ph/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Application form</h1>' }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) {
      window.visibilityQuery = query;
      window.redrawVisibilityGoogle = () => {
        window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(jobs.slice(1, 9).map(job => ({ title: job.title, url: job.url, content: job.description })))}, organic);
        window.__gcse.searchCallbacks.web.rendered();
      };
      window.redrawVisibilityGoogle();
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: {
      render(config) {
        config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div class="gsc-cursor-page gsc-cursor-current-page">1</div></div></div></div>';
        organic = config.div.querySelector('[data-organic]');
      }, getElement() { return element; }
    } } } };
    window.__gcse.initializationCallback();
  ` }));
  const card = index => page.locator(`[data-job-card="${jobs[index].id}"]`);
  const visit = async view => {
    await page.goto(`/playground-visibility-${view}`);
    await page.locator('[data-ready=true]').waitFor();
  };
  await visit('jobs');
  await page.locator('[data-job-count]').filter({ hasText: /^10 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card').count(), 10);
  for (let index = 0; index < 5; index++) assert.equal(await card(index).count(), 0);
  assert.equal(await card(5).getByRole('button', { name: 'Mark as applied' }).count(), 1);
  assert.equal(await card(6).locator('[data-mark-applied-job]').count(), 1, 'Saved jobs also have direct confirmation');
  await card(5).locator('[data-job-pick]').check();
  failSave = true;
  await card(5).getByRole('button', { name: 'Mark as applied' }).click();
  await page.locator('[data-workspace-error]').filter({ hasText: 'Could not save' }).waitFor();
  assert.equal(await card(5).count(), 1);
  assert.equal(items.find(item => item.id === 6).payload.status, 'Application opened');
  await card(5).getByRole('button', { name: 'Mark as applied' }).click();
  await card(5).waitFor({ state: 'detached' });
  assert.match(await page.locator('[data-job-count]').innerText(), /^9 results$/);
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/);

  // Opening keeps the listing available and adds its direct confirmation button.
  const popupPromise = page.waitForEvent('popup');
  await card(7).locator('[data-apply-job]').click();
  const popup = await popupPromise;
  await popup.waitForURL(jobs[7].url);
  await popup.close();
  await page.locator('[data-application-modal]').waitFor({ state: 'visible' });
  await page.locator('[data-application-later]').click();
  await page.locator('[data-application-modal]').waitFor({ state: 'hidden' });
  await card(7).locator('[data-mark-applied-job]').waitFor();
  await visit('jobs');
  await card(7).locator('[data-mark-applied-job]').waitFor();
  assert.equal(await card(5).count(), 0, 'Applied stays hidden when returning to a cached feed');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await card(7).getByRole('button', { name: 'Mark as applied' }).click();
  await card(7).waitFor({ state: 'detached' });

  // Google uses the same tracker state and counts only the remaining cards.
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^2 results on this page$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 2);
  assert.match(await page.locator('[data-google-page-count]').innerText(), /Showing 2 entries/);
  const googleCard = page.locator('.google-job-card').filter({ hasText: 'Assistant 6' });
  const googlePopupPromise = page.waitForEvent('popup');
  await googleCard.locator('[data-apply-job]').click();
  const googlePopup = await googlePopupPromise;
  await googlePopup.waitForURL(jobs[6].url);
  await googlePopup.close();
  await page.locator('[data-application-modal]').waitFor({ state: 'visible' });
  failSave = true;
  await page.locator('[data-application-submit]').click();
  await page.locator('[data-application-error]').filter({ hasText: 'Could not save' }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 2);
  await page.locator('[data-application-submit]').click();
  await page.locator('[data-application-success]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.google-job-card').count(), 1);
  await page.locator('[data-application-later]').click();
  await page.locator('[data-application-modal]').waitFor({ state: 'hidden' });
  const keyboardPopupPromise = page.waitForEvent('popup');
  await page.locator('.google-job-card [data-apply-job]').click();
  const keyboardPopup = await keyboardPopupPromise;
  await keyboardPopup.waitForURL(jobs[8].url);
  await keyboardPopup.close();
  await page.locator('[data-application-modal]').waitFor({ state: 'visible' });
  await page.locator('[data-application-later]').click();
  await page.locator('[data-application-modal]').waitFor({ state: 'hidden' });
  // Google's widget can swallow keyboard events; the card handles confirmation.
  await page.locator('.google-job-card [data-mark-applied-job]').press('Enter');
  await page.locator('.google-job-card').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.google-job-card').count(), 0);
  assert.match(await page.locator('[data-job-count]').innerText(), /^0 results on this page$/);
  assert.match(await page.locator('[data-google-page-count]').innerText(), /Showing 0 entries/);
  await page.evaluate(() => window.redrawVisibilityGoogle());
  await page.locator('.google-job-grid').getByText('No open, unapplied jobs', { exact: false }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 0, 'Provider redraw also filters applied jobs');

  // Tracker edits are reconciled on navigation, including a slow fresh response.
  await visit('applications');
  const statusSave = page.waitForResponse(response => response.request().method() === 'POST');
  await page.locator('[data-entry-status="7"]').selectOption('Saved');
  await statusSave;
  assert.equal(items.find(item => item.id === 7).payload.status, 'Saved');
  await visit('jobs');
  await page.locator('.google-job-card').waitFor();
  await page.locator('#job-source').selectOption('all');
  await card(6).waitFor();
  items.find(item => item.id === 7).payload.status = 'Applied';
  let release;
  workspaceGate = new Promise(resolve => { release = resolve; });
  await page.reload();
  await card(6).waitFor();
  release();
  workspaceGate = null;
  await card(6).waitFor({ state: 'detached' });
  // A cached Applied status must not prevent availability checks from running.
  // A delayed fresh tracker response may restore the same job to Saved.
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-google-jobs-host] .google-job-grid').waitFor();
  items.find(item => item.id === 7).payload.status = 'Saved';
  workspaceGate = new Promise(resolve => { release = resolve; });
  await page.reload();
  await page.locator('[data-google-jobs-host] .google-job-grid').waitFor();
  release(); workspaceGate = null;
  await page.locator('.google-job-card').waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 1, 'Fresh tracker state restores an open listing even when the preview said Applied');
  assert.deepEqual(errors, []);
  console.log('PASS: applied and later statuses hidden across feeds/Google/cache, opened-card confirmation, failed-save retries, selection/counts, mobile layout, tracker edits and delayed refresh.');
} finally {
  await browser?.close();
  await Promise.all(created.map(preview => unlink(preview)));
}
