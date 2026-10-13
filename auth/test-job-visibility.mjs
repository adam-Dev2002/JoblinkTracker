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
  assert.equal(await page.locator('.job-card [data-mark-applied-job]').count(), 10, 'Every card offers confirmation before opening or saving');
  for (let index = 0; index < 5; index++) assert.equal(await card(index).count(), 0);
  assert.equal(await card(5).getByRole('button', { name: 'Mark as applied' }).count(), 1);
  assert.equal(await card(6).locator('[data-mark-applied-job]').count(), 1, 'Saved jobs also have direct confirmation');
  assert.equal(await card(6).locator('[data-track] .job-card-button-label').innerText(), 'Saved', 'Previously tracked cards show their saved state');
  assert.equal(await card(7).locator('[data-track] .job-card-button-label').innerText(), 'Save', 'Untracked cards keep an accurate Save action');
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

  // Opening keeps the listing available without adding an application.
  const postsBeforeOpening = posts;
  const popupPromise = page.waitForEvent('popup');
  await card(7).locator('[data-apply-job]').click();
  const popup = await popupPromise;
  await popup.waitForURL(jobs[7].url);
  await popup.close();
  assert.equal(await page.locator('[data-application-modal], .modal-backdrop').count(), 0);
  assert.equal(items.some(item => item.payload.jobId === jobs[7].id), false);
  assert.equal(posts, postsBeforeOpening, 'Opening an untracked feed job sends no workspace write');
  await card(7).locator('[data-mark-applied-job]').waitFor();
  // Opening from details also leaves the tracker untouched.
  await card(7).locator('[data-job-details]').first().click();
  await page.locator('[data-job-details-modal]').waitFor({ state: 'visible' });
  const detailsPopupPromise = page.waitForEvent('popup');
  await page.locator('[data-details-apply]').click();
  const detailsPopup = await detailsPopupPromise;
  await detailsPopup.waitForURL(jobs[7].url);
  await detailsPopup.close();
  await page.locator('[data-job-details-modal]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-application-modal], .modal-backdrop').count(), 0);
  assert.equal(items.filter(item => item.payload.jobId === jobs[7].id).length, 0);
  assert.equal(posts, postsBeforeOpening, 'Opening from details sends no workspace write');
  await page.evaluate(() => sessionStorage.setItem('jobify-opened-application', '6'));
  await visit('jobs');
  assert.equal(await page.locator('[data-application-modal], .modal-backdrop').count(), 0, 'Legacy session state cannot restore the reminder');
  await card(7).locator('[data-mark-applied-job]').waitFor();
  assert.equal(await card(5).count(), 0, 'Applied stays hidden when returning to a cached feed');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await card(7).getByRole('button', { name: 'Mark as applied' }).click();
  await card(7).waitFor({ state: 'detached' });

  // Google uses the same tracker state and counts only the remaining cards.
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 2);
  assert.equal(await page.locator('.google-job-card [data-mark-applied-job]').count(), 2, 'Google cards offer the same direct action');
  assert.match(await page.locator('[data-job-pagination]').innerText(), /Showing 1–2 of 2 results/);
  const savedBeforeOpening = structuredClone(items.find(item => item.id === 7));
  const postsBeforeGoogleOpening = posts;
  const googleCard = page.locator('.google-job-card').filter({ hasText: 'Assistant 6' });
  const googlePopupPromise = page.waitForEvent('popup');
  await googleCard.locator('[data-apply-job]').click();
  const googlePopup = await googlePopupPromise;
  await googlePopup.waitForURL(jobs[6].url);
  await googlePopup.close();
  assert.deepEqual(items.find(item => item.id === 7), savedBeforeOpening, 'Opening a saved Google result preserves its record');
  assert.equal(posts, postsBeforeGoogleOpening);
  assert.equal(await page.locator('[data-application-modal], .modal-backdrop').count(), 0);
  failSave = true;
  await googleCard.locator('[data-mark-applied-job]').click();
  await page.locator('[data-workspace-error]').filter({ hasText: 'Could not save' }).waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 2);
  assert.equal(await googleCard.locator('[data-mark-applied-job]').isEnabled(), true);
  await googleCard.locator('[data-mark-applied-job]').click();
  await googleCard.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.google-job-card').count(), 1);
  // Google's widget can swallow keyboard events; confirm an unopened job directly.
  assert.equal(items.some(item => item.payload.url === jobs[8].url), false);
  await page.locator('.google-job-card [data-mark-applied-job]').press('Enter');
  await page.locator('.google-job-card').waitFor({ state: 'detached' });
  assert.equal(items.find(item => item.payload.url === jobs[8].url).payload.status, 'Applied');
  assert.equal(await page.locator('.google-job-card').count(), 0);
  assert.match(await page.locator('[data-job-count]').innerText(), /^0 results$/);
  assert.equal(await page.locator('[data-job-pagination]').isVisible(), false);
  await page.evaluate(() => window.redrawVisibilityGoogle());
  await page.locator('[data-job-empty]').waitFor();
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
  // A cached Applied status must not prevent Google results from loading.
  // A delayed fresh tracker response may restore the same job to Saved.
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-google-jobs-host] .gsc-results').waitFor({ state: 'attached' });
  items.find(item => item.id === 7).payload.status = 'Saved';
  workspaceGate = new Promise(resolve => { release = resolve; });
  await page.reload();
  await page.locator('[data-google-jobs-host] .gsc-results').waitFor({ state: 'attached' });
  release(); workspaceGate = null;
  await page.locator('.google-job-card').waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 1, 'Fresh tracker state restores an open listing even when the preview said Applied');
  await page.locator('#job-source').selectOption('all');
  await card(14).locator('[data-mark-applied-job]').waitFor();
  assert.equal(items.some(item => item.payload.jobId === jobs[14].id), false);
  await card(14).locator('[data-mark-applied-job]').press('Space');
  await card(14).waitFor({ state: 'detached' });
  assert.equal(items.find(item => item.payload.jobId === jobs[14].id).payload.status, 'Applied', 'Unopened feed jobs can be confirmed directly');
  assert.equal(items.filter(item => item.payload.jobId === jobs[14].id).length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: reminder-free opening/details/navigation, every-card confirmation across feeds/Google, unopened-job keyboard saves, failed-save retries, visibility/counts, mobile layout, tracker edits and delayed refresh.');
} finally {
  await browser?.close();
  await Promise.all(created.map(preview => unlink(preview)));
}
