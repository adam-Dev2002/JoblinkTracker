import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Run the actual search UI with isolated API/Google fixtures, without account writes.
const preview = new URL('../jobfinder/preview/pages/playground-empty-job-search.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Empty search" description="Search result regression" />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
    headless: true,
  });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const developer = { id: 'developer', title: 'AI Developer', company: 'Example', location: 'Manila', employmentType: 'Full-time',
    role: 'Development & IT', url: 'https://example.com/jobs/developer', source: 'Fixture feed', salary: '', date: new Date().toISOString(),
    logo: '', workMode: 'Remote', description: 'Software development in Manila.', direct: false };
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Search fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill(q === 'feed-error' ? { status: 503, json: { error: 'Fixture feed unavailable' } }
      : { json: { jobs: !q || q === 'developer' ? [developer] : [], message: 'Fixture feed' } });
  });
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic, host;
    window.searchQueries = [];
    const rows = [{ title: 'AI-First Developer', url: 'https://www.onlinejobs.ph/jobseekers/job/developer-123', content: 'Full-time role in Manila. Build software.' },
      { title: 'Chair Developer', url: 'https://www.onlinejobs.ph/jobseekers/job/chair-456', content: 'Manufacture chairs in Manila.' }];
    window.replySearch = query => {
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], rows, organic);
      window.__gcse.searchCallbacks.web.rendered();
      // Google adds its spelling/no-results UI outside the organic callback.
      host.querySelector('[data-provider-messages]')?.remove();
      const messages = document.createElement('div');
      messages.dataset.providerMessages = '';
      const correction = document.createElement('div');
      correction.className = 'gs-result';
      for (const label of ['Showing results for ', 'Search instead for ']) {
        const line = document.createElement('div');
        line.className = 'gs-spelling';
        line.textContent = label + query;
        correction.append(line);
      }
      const empty = document.createElement('div');
      empty.className = 'gs-result gs-no-results-result';
      empty.textContent = 'No results found. Try different keywords.';
      messages.append(correction, empty);
      host.querySelector('.gsc-results').append(messages);
    };
    const element = { execute(query) {
      window.searchQueries.push(query);
      window.__gcse.searchCallbacks.web.starting('joblink-google-jobs', query);
      if (!window.holdSearch) window.replySearch(query);
    }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) {
      host = config.div;
      config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div class="gsc-cursor-page gsc-cursor-current-page">1</div></div></div><div class="gcsc-more-maybe-branding-root">Enhanced by Google (fixture)</div></div>';
      organic = config.div.querySelector('[data-organic]');
    }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  const search = async query => {
    await page.locator('#job-query').fill(query);
    await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
    await page.locator('[data-job-search][aria-busy="false"]').waitFor();
    await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
  };
  const expectEmpty = async () => {
    await page.locator('[data-job-empty]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-job-empty]').innerText(), 'No results');
    assert.equal(await page.locator('.job-card').count(), 0, 'No previous or related cards remain');
    assert.equal(await page.locator('.workspace-empty:visible').count(), 1, 'One empty state across both sources');
    assert.equal(await page.locator('[data-job-selection-toolbar]').isVisible(), false);
    assert.equal(await page.locator('[data-job-pagination]').isVisible(), false);
    assert.equal(await page.locator('.gsc-cursor-box:visible').count(), 0);
    assert.equal(await page.locator('.gs-spelling:visible, .gs-no-results-result:visible').count(), 0, 'Provider spelling and duplicate empty messages do not expose internal queries');
    if (await page.locator('[data-google-jobs]').evaluate(panel => !panel.classList.contains('d-none')))
      assert.equal(await page.locator('.gcsc-more-maybe-branding-root').isVisible(), true, 'Google attribution remains visible');
    assert.ok(await page.locator('[data-job-empty]').evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 20, 'The empty message has larger readable text');
  };
  await page.goto('/playground-empty-job-search');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-job-count]').filter({ hasText: /^1 results$/ }).waitFor();

  await search('unavailable-unicorn-role');
  await expectEmpty();
  assert.equal(await page.locator('[data-job-count]').innerText(), '0 results');
  if (process.env.JOBLINK_EMPTY_SCREENSHOT) await page.locator('.job-results-panel').screenshot({ path: process.env.JOBLINK_EMPTY_SCREENSHOT });

  await search('AI developer');
  await page.locator('.google-job-card').waitFor();
  assert.equal(await page.locator('.google-job-card').count(), 1, 'AI cannot match Chair');
  assert.equal(await page.locator('[data-job-count]').innerText(), '1 results', 'Google matches count when feeds are empty');
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false);
  await page.locator('[data-job-select-all]').check();

  // Reproduce the screenshot: a role entered as a location must not show cards.
  await page.locator('#job-location').fill('web developer');
  await page.locator('#job-employment').selectOption('Full-time');
  await page.locator('#job-listing-time').selectOption('1');
  await search('AI developer');
  await expectEmpty();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await expectEmpty();

  await page.locator('#job-source').selectOption('google');
  await expectEmpty();
  assert.equal(await page.locator('[data-job-count]').innerText(), '0 results on this page');
  await page.locator('#job-location').fill('');
  await page.locator('#job-employment').selectOption('');
  await page.locator('#job-listing-time').selectOption('');
  await search('AI developer');
  await page.locator('.google-job-card').waitFor();
  assert.equal(await page.locator('[data-job-count]').innerText(), '1 results on this page');

  // A slow earlier search cannot overwrite the latest empty results.
  await page.evaluate(() => { window.holdSearch = true; });
  await page.locator('#job-query').fill('developer delayed');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => window.searchQueries.at(-1).startsWith('developer delayed'));
  const oldQuery = await page.evaluate(() => window.searchQueries.at(-1));
  assert.equal(await page.locator('.job-card').count(), 0, 'Old Google cards clear before the pending response');
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false, 'Pending searches are not empty results');
  await page.evaluate(() => { window.holdSearch = false; });
  await search('no-such-position');
  await expectEmpty();
  await page.evaluate(query => window.replySearch(query), oldQuery);
  await expectEmpty();

  await page.locator('#job-source').selectOption('remotive');
  await expectEmpty();
  await search('developer');
  await page.locator('[data-job-results] .job-card').waitFor();
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false);
  await search('feed-error');
  await page.locator('[data-workspace-error]:not(.d-none)').waitFor();
  assert.equal(await page.locator('[data-job-empty]').isVisible(), false, 'Failures retain their error state');
  assert.deepEqual(errors, []);
  console.log('PASS: unmatched feed/Google searches, exact keywords, location mismatch, combined counts, cache restoration, selection cleanup, mobile, delayed responses and feed errors.');
} finally {
  if (browser) await browser.close();
  await unlink(preview);
}
