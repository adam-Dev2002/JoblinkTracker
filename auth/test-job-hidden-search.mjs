import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { mockOpenAvailability } from './job-availability-fixture.mjs';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Real listing UI with account-scoped mock APIs; no real account/data writes.
const urls = [
  'https://www.onlinejobs.ph/jobseekers/job/Assistant-1748721',
  'https://www.onlinejobs.ph/jobseekers/job/Engineer-1748722',
  'https://www.onlinejobs.ph/jobseekers/job/Untracked-1748723',
  'https://www.onlinejobs.ph/jobseekers/job/Assistant-1748999',
  'https://ph.indeed.com/viewjob?jk=applied42&from=feed',
  'https://boards.greenhouse.io/company/jobs/998001?gh_src=feed',
];
const returningUrls = [
  'https://onlinejobs.ph/jobseekers/job/Updated-title-1748721/?ref=google&utm_source=search',
  'http://www.onlinejobs.ph/jobseekers/job/1748722#apply',
  'https://onlinejobs.ph/jobseekers/job/Untracked-1748723/?utm_source=search',
  'https://onlinejobs.ph/jobseekers/job/Assistant-1748999?utm_source=search',
  'https://www.indeed.com/viewjob?from=google&jk=applied42',
  'https://job-boards.greenhouse.io/company/jobs/998001/?gh_src=search',
];
const jobs = urls.map((url, index) => ({
  id: `hidden-${index}`, title: index === 3 ? 'Assistant' : ['Assistant', 'Engineer', 'Untracked opening', '', 'Already applied', 'Already unavailable'][index],
  company: 'Fixture company', location: 'Manila', employmentType: 'Full-time', role: 'Virtual assistance',
  url, source: 'Original feed', salary: '', date: new Date().toISOString(), logo: '', workMode: 'Remote / WFH', description: 'Job description', direct: false,
}));
const returning = jobs.map((job, index) => ({ ...job, id: `returning-${index}`, source: 'Another feed', url: returningUrls[index] }));
const entry = (id, index, status, url = urls[index]) => ({ id, kind: 'application', payload: { ...jobs[index], jobId: jobs[index].id, url, status, notes: 'Keep my notes', date: '2026-10-01' } });
const items = [entry(10, 0, 'Saved', returningUrls[0]), entry(11, 4, 'Applied'), entry(12, 4, 'Saved', returningUrls[4]), entry(13, 5, 'Unavailable')];
const errors = [];
const preview = new URL('../jobfinder/preview/pages/playground-hidden-search.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Hidden job search" description="Persistent posting exclusion regression" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.JOBLINK_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  async function account(owner, holdWorkspace = false) {
    let release;
    const workspaceReady = new Promise(resolve => { release = resolve; });
    const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
    await mockOpenAvailability(context);
    await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: owner, name: 'Hidden job fixture', email: `owner-${owner}@example.invalid`, provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
    await context.route('**/api/workspace/items', async route => {
      if (route.request().method() === 'GET') {
        if (holdWorkspace) await workspaceReady;
        return route.fulfill({ json: { items: owner === 1 ? items : [] } });
      }
      assert.equal(owner, 1);
      const input = route.request().postDataJSON();
      let item = items.find(item => item.id === input.id);
      if (item) item.payload = input.payload;
      else { item = { id: 100 + items.length, kind: 'application', payload: input.payload }; items.push(item); }
      return route.fulfill({ json: { item } });
    });
    await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: new URL(route.request().url()).searchParams.get('q') ? returning : jobs, message: 'Fixture jobs', configured: true } }));
    await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
    await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
      let organic, generation = 0;
      const listings = ${JSON.stringify(jobs.map((job, index) => ({ title: job.title, url: returningUrls[index], content: job.description })))};
      const element = { execute(query) {
        window.redrawHiddenSearch = () => {
          const results = listings.map((job, index) => {
            const target = new URL(job.url);
            target.searchParams.set('utm_campaign', 'search-' + ++generation);
            return { ...job, url: index === 0 ? 'https://www.google.com/url?q=' + encodeURIComponent(target.href) : target.href };
          });
          window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], results, organic);
          window.__gcse.searchCallbacks.web.rendered();
        };
        window.redrawHiddenSearch();
      }, clearAllResults() {} };
      window.google = { search: { cse: { element: { render(config) {
        config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div class="gsc-cursor-page gsc-cursor-current-page">1</div></div></div></div>';
        organic = config.div.querySelector('[data-organic]');
      }, getElement() { return element; } } } } };
      window.__gcse.initializationCallback();
    ` }));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    return { context, page, release };
  }
  const { page } = await account(1);
  const card = id => page.locator(`[data-job-card="${id}"]`);
  const finishUnavailable = async () => {
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' });
    await page.locator('[data-removal-success-close]').click();
  };
  const search = async (target, query) => {
    await target.locator('#job-query').fill(query);
    await target.locator('[data-job-search]').evaluate(form => form.requestSubmit());
    await target.locator('[data-job-search][aria-busy="false"]').waitFor();
  };
  const expectRemaining = async target => {
    await target.waitForFunction(() => document.querySelectorAll('[data-job-results] .job-card').length === 2 && document.querySelectorAll('[data-google-jobs-host] .google-job-card').length === 2);
    for (const selector of ['[data-job-results] .job-title-link', '[data-google-jobs-host] .job-title-link']) {
      assert.deepEqual(await target.locator(selector).allTextContents(), [jobs[2].title, jobs[3].title], 'Applied/unavailable postings are excluded, while a new ID with the same title remains');
    }
  };
  await page.goto('/playground-hidden-search');
  await page.locator('[data-job-count]').filter({ hasText: /^4 results$/ }).waitFor();
  await card(jobs[0].id).locator('[data-mark-applied-job]').click();
  await card(jobs[0].id).waitFor({ state: 'detached' });
  assert.equal(items.find(item => item.id === 10).payload.status, 'Applied', 'Existing saved records are reused through canonical URLs');
  assert.equal(items.filter(item => item.payload.title === 'Assistant').length, 1, 'Marking applied does not create a duplicate application');
  await card(jobs[1].id).locator('[data-mark-unavailable-job]').click();
  await card(jobs[1].id).waitFor({ state: 'detached' });
  await finishUnavailable();
  await search(page, 'search again');
  await expectRemaining(page);
  for (const [selector, value] of [['#job-employment', 'Full-time'], ['#job-classification', 'Virtual assistance'], ['#job-listing-time', '7']]) {
    await page.locator(selector).selectOption(value);
    await expectRemaining(page);
    await page.locator(selector).selectOption('');
    await expectRemaining(page);
  }
  await page.locator('#job-location').fill('Manila');
  await search(page, 'another search');
  await expectRemaining(page);
  for (const source of ['google', 'jobicy', 'remotive', 'arbeitnow', 'all']) {
    await page.locator('#job-source').selectOption(source);
    await page.locator('[data-job-search][aria-busy="false"]').waitFor();
    if (source === 'google') await page.waitForFunction(() => !document.querySelector('[data-job-results] .job-card') && document.querySelectorAll('.google-job-card').length === 2);
    else if (source === 'all') await expectRemaining(page);
    else {
      await page.locator('[data-google-jobs]').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelectorAll('[data-job-results] .job-card').length === 2);
    }
  }
  await page.evaluate(() => window.redrawHiddenSearch());
  await expectRemaining(page);
  await page.locator('.google-job-card').filter({ hasText: jobs[2].title }).locator('[data-mark-unavailable-job]').click();
  await finishUnavailable();
  await page.waitForFunction(() => document.querySelectorAll('[data-job-results] .job-card').length === 1 && document.querySelectorAll('.google-job-card').length === 1);
  await page.locator('[data-job-select-all]').check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 2, 'Selection includes only the remaining posting across sources');
  await page.locator('[data-job-bulk-apply]').click();
  await page.waitForFunction(() => !document.querySelector('.job-card'));
  assert.equal(items.filter(item => item.payload.url.includes('1748999')).length, 1, 'Bulk matching reuses the same posting across feeds and Google');
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^0 results$/ }).waitFor();
  assert.equal(await page.locator('.job-card').count(), 0, 'Cached searches cannot resurrect hidden postings');
  const { page: fresh } = await account(1);
  await fresh.goto('/playground-hidden-search');
  await fresh.locator('[data-job-count]').filter({ hasText: /^0 results$/ }).waitFor();
  await search(fresh, 'fresh session search');
  await fresh.locator('[data-google-jobs-host] .google-job-grid').waitFor();
  assert.equal(await fresh.locator('.job-card').count(), 0, 'A fresh authenticated session with empty browser storage uses saved account statuses');
  const delayed = await account(1, true);
  await delayed.context.addInitScript(() => sessionStorage.setItem('joblink-page-data-v1:job-filters', JSON.stringify({ owner: 1, time: Date.now(), data: { values: ['slow account load', 'all', '', '', '', ''], page: 1 } })));
  await delayed.page.goto('/playground-hidden-search');
  await delayed.page.locator('[data-job-search][aria-busy="false"]').waitFor();
  await delayed.page.waitForFunction(() => typeof window.redrawHiddenSearch === 'function' && document.querySelector('[data-google-jobs]').getAttribute('aria-busy') === 'false');
  assert.equal(await delayed.page.locator('[data-workspace-view="jobs"][data-ready=true]').count(), 0, 'The tracker request is still pending');
  assert.equal(await delayed.page.locator('.job-card').count(), 0, 'Fast feed and Google results cannot flash hidden cards before account statuses load');
  delayed.release();
  await delayed.page.locator('[data-ready=true]').waitFor();
  await delayed.page.locator('[data-google-jobs-host] .google-job-grid').waitFor();
  assert.equal(await delayed.page.locator('.job-card').count(), 0, 'Statuses are applied before the first cards are rendered');
  const { page: other } = await account(2);
  await other.goto('/playground-hidden-search');
  await other.locator('[data-job-count]').filter({ hasText: /^6 results$/ }).waitFor();
  assert.equal(await other.locator('.job-card').count(), 6, 'Hidden status never affects another account');
  items.find(item => item.payload.jobId === jobs[1].id).payload.status = 'Saved';
  await fresh.reload();
  await fresh.locator('[data-job-count]').filter({ hasText: /^1 results$/ }).waitFor();
  await fresh.waitForFunction(() => document.querySelectorAll('[data-google-jobs-host] .google-job-card').length === 1);
  assert.deepEqual(await fresh.locator('[data-job-results] .job-title-link').allTextContents(), [jobs[1].title], 'Only an explicit status restoration brings a posting back');
  assert.deepEqual(errors, []);
  console.log('PASS: applied/unavailable hiding across changed URLs, searches, every filter/source, Google redraws, duplicates, bulk selection, reload, fresh sessions and account isolation; no card flash during slow account loads; Saved restoration and distinct new postings.');
} finally {
  await browser?.close();
  await unlink(preview);
}
