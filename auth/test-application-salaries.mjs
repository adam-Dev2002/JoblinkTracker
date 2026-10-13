import assert from 'node:assert/strict';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const previews = ['applications', 'jobs', 'dashboard'].map(view => new URL(`../jobfinder/preview/pages/playground-salary-${view}.astro`, import.meta.url));
const created = [];
let browser, release;
try {
  for (const [index, file] of previews.entries()) {
    const view = ['applications', 'jobs', 'dashboard'][index];
    await writeFile(file, `---\nimport WorkspacePage from '../components/workspace/WorkspacePage.astro'\n---\n<WorkspacePage view="${view}" title="Salary and status preview" description="Application salaries and colors" />\n`, { flag: 'wx' });
    created.push(file);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], salaryReads = [], refreshes = [];
  const statuses = ['Saved', 'Application opened', 'Unavailable', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'];
  const colors = ['secondary', 'azure', 'orange', 'blue', 'purple', 'green', 'red', 'yellow'];
  const items = statuses.map((status, index) => ({ id: index + 1, kind: 'application', payload: { title: `Tracked role ${index + 1}`, company: 'Fixture company', salary: index === 1 ? 'PHP 99,000/month (manual)' : '', status, date: '2026-10-14', notes: 'Personal notes', url: index < 3 ? `https://www.onlinejobs.ph/jobseekers/job/salary-${78000 + index}` : `https://example.com/jobs/${index}` } }));
  const manual = structuredClone(items[1]);
  let rejectStatus = false;
  const hold = new Promise(resolve => { release = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Salary fixture', email: 'salary@example.invalid', provider: 'email' }, csrf: 'salary-fixture' } }));
  await context.route('**/api/workspace/items', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    const input = route.request().postDataJSON();
    if (rejectStatus) { rejectStatus = false; return route.fulfill({ status: 503, json: { error: 'Fixture status save failed.' } }); }
    let item = items.find(item => item.id === input.id);
    if (item) item.payload = input.payload;
    else { item = { id: 100 + items.length, kind: 'application', payload: input.payload }; items.push(item); }
    return route.fulfill({ json: { item } });
  });
  await context.route('**/api/workspace/salaries', async route => {
    const input = route.request().postDataJSON();
    assert.equal(route.request().headers()['x-csrf-token'], 'salary-fixture');
    refreshes.push(input.ids);
    await hold;
    const updated = [];
    for (const id of input.ids) {
      const item = items.find(item => item.id === id);
      if (id === 1 && !item.payload.salary) { item.payload.salary = 'PHP 40,000/month'; updated.push({ id, salary: item.payload.salary }); }
    }
    return route.fulfill({ json: { updated } });
  });
  await context.route('**/api/jobs/salary', route => {
    const input = route.request().postDataJSON();
    salaryReads.push(...input.urls);
    return route.fulfill({ json: { results: input.urls.map(url => ({ url, salary: 'USD 25/hour', state: 'found' })) } });
  });
  const feed = { id: 'salary-feed', title: 'Feed Assistant', company: 'Fixture company', location: 'Manila', salary: '', description: '<p>Salary: PHP 30,000 per month</p>', url: 'https://example.com/assistant', source: 'Fixture feed', direct: false, date: '', logo: '', workMode: 'Remote', employmentType: 'Full-time', role: 'Virtual assistance' };
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: [feed], message: 'Fixture salary feed', configured: true } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  const google = [{ title: 'Google Assistant with pay', url: 'https://www.onlinejobs.ph/jobseekers/job/assistant-78901', content: 'Remote assistant paying $8 – $12/hour.' }, { title: 'Google Assistant without snippet pay', url: 'https://www.onlinejobs.ph/jobseekers/job/assistant-78902', content: 'Remote assistant job.' }];
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let organic;
    const element = { execute(query) { window.__gcse.searchCallbacks.web.ready('joblink-google-jobs', query, [], ${JSON.stringify(google)}, organic); window.__gcse.searchCallbacks.web.rendered(); }, clearAllResults() {} };
    window.google = { search: { cse: { element: { render(config) { config.div.innerHTML = '<div class="gsc-results gsc-webResult"><div data-organic></div></div>'; organic = config.div.querySelector('[data-organic]'); }, getElement() { return element; } } } } };
    window.__gcse.initializationCallback();
  ` }));
  const visit = async view => { await page.goto(`/playground-salary-${view}`); await page.locator('[data-ready=true]').waitFor(); };
  await visit('applications');
  await page.locator('[data-application-salary="1"]').filter({ hasText: 'Fetching' }).waitFor();
  assert.equal(await page.locator('[data-entry-status]').count(), 8, 'Salary fetching does not block the table');
  assert.deepEqual(refreshes[0], [1, 3], 'Refresh only blank salaries on supported listing URLs');
  for (const [index, color] of colors.entries()) assert.equal(await page.locator(`[data-entry-status="${index + 1}"]`).getAttribute('data-status-color'), color);
  async function checkColors() {
    const styles = await page.locator('[data-entry-status]').evaluateAll(controls => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      const rgb = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = values => values.map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      return controls.map(control => { const style = getComputedStyle(control), foreground = luminance(rgb(style.color)), background = luminance(rgb(style.backgroundColor)); return { color: style.backgroundColor, contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) }; });
    });
    assert.equal(new Set(styles.map(style => style.color)).size, 8, 'All eight statuses have distinct colors');
    for (const style of styles) assert.ok(style.contrast >= 4.5, `Status text stays readable: ${JSON.stringify(style)}`);
  }
  await checkColors();
  release();
  await page.locator('[data-application-salary="1"]').filter({ hasText: 'PHP 40,000/month' }).waitFor();
  assert.deepEqual(items[1], manual, 'A manual salary is never overwritten');
  assert.equal(await page.locator('[data-application-salary="3"]').innerText(), '—', 'Undisclosed pay is left empty');
  await mkdir(new URL('../.local-tools/', import.meta.url), { recursive: true });
  await page.screenshot({ path: '.local-tools/application-status-salaries-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.bsTheme = 'dark'; document.body.dataset.bsTheme = 'dark'; });
  await checkColors();
  await page.screenshot({ path: '.local-tools/application-status-salaries-dark.png' });
  rejectStatus = true;
  await page.locator('[data-entry-status="1"]').selectOption('Offer');
  await page.locator('[data-workspace-error]').filter({ hasText: 'Fixture status save failed' }).waitFor();
  assert.equal(await page.locator('[data-entry-status="1"]').getAttribute('data-status-color'), 'secondary', 'A failed status save restores its color');
  await page.locator('[data-entry-status="1"]').selectOption('Interview');
  await page.waitForFunction(() => document.querySelector('[data-entry-status="1"]')?.dataset.statusColor === 'purple');
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  assert.equal(await page.locator('[data-entry-status="1"]').getAttribute('data-status-color'), 'purple');
  assert.equal(await page.locator('[data-application-salary="1"]').innerText(), 'PHP 40,000/month');
  await visit('jobs');
  await page.locator('[data-track="salary-feed"]').click();
  assert.equal(await page.getByLabel('Salary / range', { exact: true }).inputValue(), 'PHP 30,000/month');
  await page.locator('[data-entry-form] button[type=submit]').click();
  await page.locator('[data-entry-modal]').waitFor({ state: 'hidden' });
  assert.equal(items.find(item => item.payload.jobId === feed.id).payload.salary, 'PHP 30,000/month');
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-job-count]').filter({ hasText: /^2 results$/ }).waitFor();
  await page.locator('.google-job-card').filter({ hasText: 'Google Assistant with pay' }).locator('[data-mark-applied-job]').click();
  await page.locator('[data-job-count]').filter({ hasText: /^1 results$/ }).waitFor();
  assert.equal(items.find(item => item.payload.url === google[0].url).payload.salary, '$ 8–12/hour');
  assert.deepEqual(salaryReads, [], 'A salary from the search snippet requires no extra source request');
  await page.locator('.google-job-card [data-mark-applied-job]').click();
  await page.locator('[data-job-empty]').waitFor();
  assert.equal(items.find(item => item.payload.url === google[1].url).payload.salary, 'USD 25/hour');
  assert.deepEqual(salaryReads, [google[1].url]);
  await visit('applications');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Colored status controls preserve mobile table scrolling');
  }
  await visit('dashboard');
  assert.equal(await page.locator('.dashboard-application-status[data-status-color]').count(), 7);
  assert.deepEqual(errors, []);
  console.log('PASS: all status colors and readable light/dark contrast, failed-save color restoration, background salary fetching, manual salary preservation, feed/snippet/source salary persistence, reloads, dashboard colors and mobile layouts.');
} finally {
  release?.();
  await browser?.close();
  await Promise.all(created.map(file => unlink(file)));
}
