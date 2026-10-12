import assert from 'node:assert/strict';
import { mockOpenAvailability } from './job-availability-fixture.mjs';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Exercise real page components with delayed APIs, without creating accounts.
const views = ['dashboard', 'applications', 'taskboard', 'calendar', 'links', 'sheet', 'jobs', 'news'];
const previews = views.map(view => new URL(`../jobfinder/preview/pages/playground-loading-${view}.astro`, import.meta.url));
let browser;
const created = [];
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
try {
  for (const [index, preview] of previews.entries()) {
    await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="${views[index]}" title="Loading preview" description="Navigation loading verification" />
`, { flag: 'wx' });
    created.push(preview);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 } });
  const page = await context.newPage();
  await mockOpenAvailability(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  let userId = 1;
  let readGate = gate();
  let jobsGate = null;
  let newsGate = null;
  let googleGate = null;
  let failItems = false;
  let failJobs = false;
  let failNews = false;
  const eventDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
  let items = ['application', 'task', 'event', 'link', 'sheet'].map((kind, index) => ({
    id: index + 1, kind, attachments: [], payload: {
      title: `Saved ${kind}`, company: 'Example company', status: kind === 'task' ? 'To do' : 'Saved',
      date: eventDate, time: '09:00', url: 'https://example.com/jobs/tracked', salary: '', value: '123', notes: 'Saved notes',
    },
  }));
  const jobs = Array.from({ length: 13 }, (_, index) => ({
    id: `loading-${index}`, title: `Developer ${index}`, company: 'Example company', location: 'Manila',
    employmentType: 'Full-time', role: 'Development & IT', url: `https://example.com/jobs/${index}`,
    source: 'Test feed', salary: '', date: eventDate, logo: '', workMode: 'Remote / WFH', description: 'Developer role', direct: false,
  }));
  const stories = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, title: `Career story ${index}`, url: 'https://dev.to/example/story', source: 'DEV Community', author: 'Author', date: eventDate, image: '', description: 'A useful story', minutes: 3, tags: ['career'] }));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: userId, name: 'Loading preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', async route => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      const item = items.find(item => item.id === input.id);
      item.payload = input.payload;
      return route.fulfill({ json: { item } });
    }
    const snapshot = structuredClone(items);
    const hold = readGate;
    if (hold) await hold.promise;
    await route.fulfill(failItems ? { status: 503, json: { error: 'Unavailable' } } : { json: { items: userId === 1 ? snapshot : [] } });
  });
  await context.route('**/api/jobs/search*', async route => {
    if (jobsGate) await jobsGate.promise;
    await route.fulfill(failJobs ? { status: 503, json: { error: 'Feed unavailable' } } : { json: { jobs, message: 'Test feed', configured: true } });
  });
  await context.route('**/api/jobs/news', async route => {
    if (newsGate) await newsGate.promise;
    await route.fulfill(failNews ? { status: 503, json: { error: 'News unavailable' } } : { json: { articles: stories } });
  });
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', async route => {
    if (googleGate) await googleGate.promise;
    await route.fulfill({ contentType: 'application/javascript', body: `
      let resultDiv;
      const element={execute(query){window.__gcse.searchCallbacks.web.ready('joblink-google-jobs',query,[],[{title:'Google developer',url:'https://www.onlinejobs.ph/jobseekers/job/developer-123',content:'Remote developer.'}],resultDiv);window.__gcse.searchCallbacks.web.rendered()},clearAllResults(){}};
      window.google={search:{cse:{element:{render(config){config.div.innerHTML='<div data-organic></div>';resultDiv=config.div.firstElementChild},getElement(){return element}}}}};
      window.__gcse.initializationCallback();
    ` });
  });
  const visit = view => page.goto('/playground-loading-' + view, { waitUntil: 'domcontentloaded' });
  const finishRead = async () => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/workspace/items'));
    const current = readGate;
    readGate = null;
    current.release();
    await response;
  };
  await visit('applications');
  await page.waitForFunction(() => document.querySelector('[data-application-rows] .data-placeholder'));
  assert.equal(await page.locator('[data-ready=true]').count(), 0);
  assert.equal(await page.locator('[data-application-empty]').innerText(), '');
  assert.equal(await page.locator('[data-application-stat=total] .placeholder').count(), 1, 'Pending counts do not pretend to be zero');
  await finishRead();
  await page.locator('[data-ready=true]').waitFor();
  assert.match(await page.locator('[data-application-rows]').innerText(), /Saved application/);
  const selectors = {
    dashboard: '[data-dashboard-applications]', applications: '[data-application-rows]', taskboard: '[data-task-board]',
    calendar: '[data-event-list]', links: '[data-link-list]', sheet: '[data-sheet-rows]',
  };
  for (const [view, selector] of Object.entries(selectors)) {
    readGate = gate();
    await visit(view);
    await page.locator('[data-ready=true]').waitFor({ timeout: 1500 });
    assert.equal(await page.locator(selector + ' .data-placeholder').count(), 0, view + ' restores without waiting for the API');
    if (view === 'sheet') assert.equal(await page.locator('[data-sheet-field=title]').inputValue(), 'Saved sheet');
    else assert.match(await page.locator(selector).innerText(), /Saved /);
    await page.locator(selector).evaluate(node => node.firstElementChild.setAttribute('data-preserved', 'true'));
    await finishRead();
    assert.equal(await page.locator(selector + ' [data-preserved]').count(), 1, 'Unchanged refresh does not replace visible content');
  }
  readGate = gate();
  await visit('applications');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-entry-status]').selectOption('Interview');
  await page.waitForFunction(() => document.querySelector('[data-entry-status]').value === 'Interview' && JSON.parse(sessionStorage.getItem('joblink-page-data-v1:workspace')).data[0].payload.status === 'Interview');
  await finishRead();
  assert.equal(await page.locator('[data-entry-status]').inputValue(), 'Interview', 'An old background response cannot overwrite a new edit');
  failItems = true;
  await visit('links');
  await page.locator('[data-workspace-error]:not(.d-none)').waitFor();
  assert.match(await page.locator('[data-link-list]').innerText(), /Saved link/);
  assert.match(await page.locator('[data-workspace-error]').innerText(), /last loaded/);
  failItems = false;

  await page.locator('.sidebar-link[href="/job-listing"]').hover();
  await page.waitForFunction(() => sessionStorage.getItem('joblink-page-data-v1:jobs:q=&source=all'));
  jobsGate = gate();
  await visit('jobs');
  await page.locator('[data-job-results] .job-card').first().waitFor({ timeout: 1500 });
  assert.equal(await page.locator('[data-job-pick]').first().isEnabled(), true, 'Cached listings stay usable during refresh');
  jobsGate.release(); jobsGate = null;
  await page.locator('[data-job-card]').first().waitFor();
  await page.locator('#job-source').selectOption('jobicy');
  const searched = page.waitForResponse(response => response.url().includes('/api/jobs/search?') && new URL(response.url()).searchParams.get('q') === 'developer');
  await page.locator('#job-query').fill('developer');
  await searched;
  await page.waitForFunction(() => document.querySelectorAll('[data-job-results] .job-card').length === 12);
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-job-results] .job-card').length === 1);
  await visit('dashboard');
  jobsGate = gate();
  await visit('jobs');
  await page.locator('[data-job-results] .job-card').waitFor({ timeout: 1500 });
  assert.equal(await page.locator('#job-source').inputValue(), 'jobicy');
  assert.equal(await page.locator('#job-query').inputValue(), 'developer');
  assert.equal(await page.locator('[data-job-pagination] [aria-current=page]').innerText(), '2');
  failJobs = true;
  jobsGate.release(); jobsGate = null;
  await page.waitForFunction(() => document.querySelector('[data-feed-message]').textContent.includes('last loaded'));
  assert.equal(await page.locator('[data-job-results] .job-card').count(), 1);
  failJobs = false;
  await page.locator('#job-source').selectOption('google');
  await page.locator('.google-job-card').waitFor();
  await visit('dashboard');
  googleGate = gate();
  await visit('jobs');
  await page.locator('[data-google-jobs-preview] .google-job-card').waitFor({ timeout: 1500 });
  assert.equal(await page.locator('#job-source').inputValue(), 'google');
  googleGate.release(); googleGate = null;
  await page.locator('[data-google-jobs-host] .google-job-card').waitFor();
  assert.equal(await page.locator('[data-google-jobs-preview] .google-job-card').count(), 0);

  newsGate = gate();
  await visit('news');
  await page.locator('[data-news-list] .data-placeholder').waitFor();
  await page.locator('[data-news-search]').fill('career');
  assert.equal(await page.locator('[data-news-list] .data-placeholder').count(), 1);
  newsGate.release(); newsGate = null;
  await page.locator('.story-card').first().waitFor();
  await visit('dashboard');
  newsGate = gate();
  await visit('news');
  await page.locator('.story-card').first().waitFor({ timeout: 1500 });
  assert.equal(await page.locator('.story-card').count(), 3);
  failNews = true;
  newsGate.release(); newsGate = null;
  await page.locator('[data-news-status]:not(.visually-hidden)').waitFor();
  assert.equal(await page.locator('.story-card').count(), 3);
  failNews = false;
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await visit('calendar');
    await page.locator('[data-ready=true]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  readGate = gate();
  userId = 2;
  await visit('applications');
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('jobify-profile-preview') || 'null')?.user.id === 2);
  assert.doesNotMatch(await page.locator('[data-application-rows]').innerText(), /Saved application/);
  assert.equal(await page.locator('[data-ready=true]').count(), 0, 'Another account never restores the old workspace');
  await finishRead();
  await page.locator('[data-ready=true]').waitFor();
  assert.match(await page.locator('[data-application-empty]').innerText(), /No applications yet/);
  assert.deepEqual(errors, []);
  console.log('PASS: cold-load placeholders; immediate cached views across all workspaces; background refresh without repaint; edit/refresh race; retained data on errors; job filters/pages and Google previews; news caching; account isolation; responsive layouts.');
} finally {
  await browser?.close();
  for (const preview of created) await unlink(preview);
}
