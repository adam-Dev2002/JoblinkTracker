import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Exercise the real job-search UI with provider failures and isolated APIs.
const preview = new URL('../jobfinder/preview/pages/playground-google-job-errors.astro', import.meta.url);
const providerError = 'Unauthorized access to internal API. Please refer to https://support.google.com/customsearch/answer/4542055';
const jobs = Array.from({ length: 12 }, (_, index) => ({
  title: 'Developer ' + index,
  url: 'https://www.onlinejobs.ph/jobseekers/job/developer-' + (81000 + index),
  content: 'Remote full-time developer in Manila.',
}));
const siteScope = '(site:onlinejobs.ph/jobseekers/job/ OR site:linkedin.com/jobs/view/ OR site:ph.jobstreet.com/job/ OR site:jobstreet.com.ph/job/ OR site:indeed.com/viewjob OR site:jobs.lever.co OR site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com)';
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Google failures" description="Google search recovery" />
`, { flag: 'wx' });

let browser;
const errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true });

  async function fixture(initialMode) {
    let mode = initialMode;
    let scriptRequests = 0;
    const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      const schedule = window.setTimeout.bind(window);
      const cancel = window.clearTimeout.bind(window);
      const timers = new Map();
      window.setTimeout = (handler, delay, ...args) => {
        let id;
        const tracked = typeof handler === 'function' && [12000, 15000].includes(delay);
        id = schedule(tracked ? () => { timers.delete(id); handler(...args); } : handler, delay, ...args);
        if (tracked) timers.set(id, { delay, run: () => handler(...args) });
        return id;
      };
      window.clearTimeout = id => { timers.delete(id); cancel(id); };
      window.expireGoogleTimeout = delay => {
        const timer = [...timers].find(([, timer]) => timer.delay === delay);
        if (!timer) throw new Error('No pending Google timer for ' + delay);
        const [id, pending] = timer;
        timers.delete(id);
        cancel(id);
        pending.run();
      };
    });
    await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Google error fixture', email: 'google-errors@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
    await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
    await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: [], message: 'Fixture feed' } }));
    await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
    await context.route('https://cse.google.com/cse.js?cx=*', route => {
      scriptRequests++;
      if (mode === 'blocked') return route.abort();
      if (mode === 'initialization-timeout') return route.fulfill({ contentType: 'application/javascript', body: '// Provider did not initialize.' });
      return route.fulfill({ contentType: 'application/javascript', body: `
        let host, organic, query;
        window.fixtureMode = ${JSON.stringify(mode)};
        window.providerRequests = [];
        const jobs = ${JSON.stringify(jobs)};
        const rawError = ${JSON.stringify(providerError)};
        const error = () => {
          const node = document.createElement('div');
          node.className = 'gs-webResult gs-result gs-stylized-error-result';
          node.innerHTML = '<div class="gs-stylized-error-message"></div><div class="gs-stylized-error-submessage">Please try again.</div>';
          node.firstElementChild.textContent = rawError;
          host.querySelector('.gsc-results').append(node);
          // Google's API error mutates its DOM without ready or rendered callbacks.
        };
        window.emitProviderError = error;
        const draw = page => {
          const results = window.fixtureMode === 'empty' ? [] : jobs;
          window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [{ title: 'Fixture promotion', url: 'https://example.com/promotion' }], results, organic);
          host.querySelector('.gsc-cursor-box')?.remove();
          if (results.length) {
            const footer = document.createElement('div');
            footer.className = 'gsc-cursor-box';
            footer.innerHTML = '<div class="gsc-cursor"><div role="button" tabindex="0" class="gsc-cursor-page gsc-cursor-current-page">1</div><div role="button" tabindex="0" class="gsc-cursor-page">2</div></div>';
            host.querySelector('.gsc-results').insertBefore(footer, host.querySelector('.gcsc-more-maybe-branding-root'));
            footer.querySelectorAll('.gsc-cursor-page').forEach(control => control.onclick = () => request(Number(control.textContent)));
          }
          window.__gcse.searchCallbacks.web.rendered();
        };
        const request = page => {
          window.providerRequests.push({ page, query });
          window.__gcse.searchCallbacks.web.starting('joblink-google-jobs', query);
          if (window.fixtureMode === 'throw') throw new Error(rawError);
          if (window.fixtureMode === 'pending') return;
          if (window.fixtureMode === 'error' || (window.fixtureMode === 'later-error' && page > 1)) error();
          else draw(page);
        };
        const element = {
          execute(value) { query = value; request(1); },
          clearAllResults() { organic?.replaceChildren(); host?.querySelector('.gsc-cursor-box')?.remove(); },
        };
        window.google = { search: { cse: { element: {
          render(config) {
            host = config.div;
            host.innerHTML = '<div class="gsc-control-cse"><div class="gsc-results gsc-webResult"><div data-organic></div><div class="gcsc-more-maybe-branding-root">Enhanced by Google (fixture)</div></div></div>';
            organic = host.querySelector('[data-organic]');
          },
          getElement() { return element; },
        } } } };
        window.__gcse.initializationCallback();
      ` });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/playground-google-job-errors');
    await page.locator('[data-ready=true]').waitFor();
    return { context, page, scriptRequests: () => scriptRequests, setMode: async value => { mode = value; await page.evaluate(value => { window.fixtureMode = value; }, value); } };
  }

  async function start(page, keyword = 'developer') {
    await page.locator('#job-query').fill(keyword);
    await page.locator('#job-source').selectOption('google');
  }
  async function ready(page, count) {
    await page.waitForFunction(count => document.querySelectorAll('.google-job-card').length === count && document.querySelector('[data-google-jobs]').getAttribute('aria-busy') === 'false', count);
  }
  async function failed(page) {
    await page.locator('[data-google-jobs][data-search-failed="true"][aria-busy="false"]').waitFor();
    assert.equal(await page.locator('[data-google-jobs-recovery]').isVisible(), true);
    assert.equal(await page.locator('[data-google-jobs-retry]').isVisible(), true);
    assert.equal(await page.locator('[data-google-jobs-fallback]').isVisible(), true);
    assert.match(await page.locator('[data-google-jobs-status]').innerText(), /Google search.*unavailable|could not load/i);
    assert.equal(await page.locator('[data-job-empty]').isVisible(), false, 'Provider errors are not empty search results');
    assert.doesNotMatch(await page.locator('body').innerText(), /Unauthorized access|internal API|4542055/i, 'Raw provider errors never appear in the visible UI');
  }

  const initial = await fixture('error');
  await start(initial.page);
  await failed(initial.page);
  assert.equal(await initial.page.locator('.gs-stylized-error-result').count(), 1, 'Observe the actual Google error markup without provider callbacks');
  assert.equal(await initial.page.locator('.gs-stylized-error-result').isVisible(), false);
  assert.equal(await initial.page.locator('.gcsc-more-maybe-branding-root').isVisible(), true, 'Google attribution stays visible');
  const originalQuery = await initial.page.evaluate(() => window.providerRequests.at(-1).query);
  let fallback = new URL(await initial.page.locator('[data-google-jobs-fallback]').getAttribute('href'));
  assert.equal(fallback.origin + fallback.pathname, 'https://www.google.com/search');
  assert.equal(fallback.searchParams.get('q'), originalQuery);
  await initial.setMode('success');
  await initial.page.locator('[data-google-jobs-retry]').click();
  await ready(initial.page, 12);
  assert.equal(initial.scriptRequests(), 2, 'Retry reloads the official embed to renew its token');
  assert.equal(await initial.page.locator('#job-source').inputValue(), 'google', 'Retry preserves the Google source');
  assert.equal(await initial.page.locator('#job-query').inputValue(), 'developer', 'Retry preserves the search keyword');
  assert.equal(await initial.page.locator('[data-google-jobs-recovery]').isVisible(), false, 'A successful retry clears recovery');
  assert.equal(await initial.page.locator('[data-google-jobs]').getAttribute('data-search-failed'), 'false');
  assert.equal(await initial.page.getByRole('link', { name: 'Promotion: Fixture promotion' }).isVisible(), true, 'Promotions still render');
  assert.equal(await initial.page.locator('.gcsc-more-maybe-branding-root').isVisible(), true, 'Attribution survives successful recovery');

  await initial.setMode('error');
  const since = await initial.page.evaluate(() => {
    document.querySelector('#job-query').value = 'developer, engineer';
    document.querySelector('#job-location').value = 'Manila';
    document.querySelector('#job-employment').value = 'Full-time';
    document.querySelector('#job-classification').value = 'Development & IT';
    document.querySelector('#job-listing-time').value = '7';
    document.querySelector('[data-job-search]').requestSubmit();
    return new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  });
  await failed(initial.page);
  fallback = new URL(await initial.page.locator('[data-google-jobs-fallback]').getAttribute('href'));
  const filteredQuery = `(developer OR engineer) (developer OR software OR engineer OR "information technology") Manila "Full-time" after:${since} ${siteScope}`;
  assert.equal(fallback.searchParams.get('q'), filteredQuery, 'Fallback uses all current filters and the full job-site scope');
  assert.equal(await initial.page.evaluate(() => window.providerRequests.at(-1).query), filteredQuery);
  await initial.context.close();

  const empty = await fixture('empty');
  await start(empty.page);
  await ready(empty.page, 0);
  await empty.page.locator('[data-job-empty]:not(.d-none)').waitFor();
  assert.equal(await empty.page.locator('[data-job-empty]').innerText(), 'No results');
  assert.equal(await empty.page.locator('[data-google-jobs-recovery]').isVisible(), false, 'Valid empty results need no recovery');
  assert.equal(await empty.page.locator('[data-google-jobs]').getAttribute('data-search-failed'), 'false');
  await empty.context.close();

  const later = await fixture('later-error');
  await start(later.page);
  await ready(later.page, 12);
  await later.page.locator('[data-job-pagination]').getByRole('button', { name: 'Next page', exact: true }).click();
  await failed(later.page);
  assert.equal(await later.page.locator('.google-job-card').count(), 12, 'Later-page failures retain already loaded jobs');
  assert.deepEqual(await later.page.locator('.google-job-card .job-title-link').allTextContents(), jobs.map(job => job.title));
  assert.deepEqual(await later.page.evaluate(() => window.providerRequests.map(request => request.page)), [1, 2]);
  await later.context.close();

  for (const mode of ['blocked', 'throw', 'initialization-timeout']) {
    const failure = await fixture(mode);
    await start(failure.page);
    if (mode === 'initialization-timeout') await failure.page.evaluate(() => window.expireGoogleTimeout(12000));
    await failed(failure.page);
    assert.equal(await failure.page.locator('.google-job-card').count(), 0);
    await failure.context.close();
  }

  const pending = await fixture('pending');
  await start(pending.page);
  await pending.page.waitForFunction(() => window.providerRequests?.length === 1);
  await pending.page.evaluate(() => window.expireGoogleTimeout(15000));
  await failed(pending.page);
  await pending.context.close();

  const hidden = await fixture('pending');
  await start(hidden.page);
  await hidden.page.waitForFunction(() => window.providerRequests?.length === 1);
  await hidden.page.locator('#job-source').selectOption('jobicy');
  await hidden.page.evaluate(() => window.emitProviderError());
  await hidden.page.locator('[data-job-search][aria-busy="false"]').waitFor();
  assert.equal(await hidden.page.locator('[data-google-jobs]').isVisible(), false, 'Changing source cancels Google recovery');
  assert.equal(await hidden.page.locator('[data-google-jobs-recovery]').isVisible(), false, 'A late provider mutation cannot reveal fallback for another source');
  assert.equal(await hidden.page.locator('[data-google-jobs]').getAttribute('data-search-failed'), 'false');
  await hidden.context.close();

  assert.deepEqual(errors, [], 'Provider failures are contained without uncaught page errors');
  console.log('PASS: hidden Google internal API error, friendly recovery, retry, preserved filters, full Google fallback query, promotions and attribution, valid empty results, later-page preservation, blocked script, thrown error, timeouts and source cancellation.');
} finally {
  await browser?.close();
  await unlink(preview);
}
