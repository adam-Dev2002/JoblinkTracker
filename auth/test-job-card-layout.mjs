import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

// Run against the local preview with mocked APIs; no accounts or data writes.
const preview = new URL('../jobfinder/preview/pages/playground-job-card-layout.astro', import.meta.url);
await writeFile(preview, `---
import WorkspacePage from '../components/workspace/WorkspacePage.astro'
---
<WorkspacePage view="jobs" title="Find work" description="Discover jobs by role and apply on the original website." />
`, { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
    headless: true,
  });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const jobs = Array.from({ length: 13 }, (_, index) => ({
    id: `layout-${index}`, title: index % 2 ? 'Medical Billing, Coding & Arbitration Specialist (Remote | US Client)' : 'Cashier',
    company: 'Example company', location: 'Philippines', employmentType: 'Full-time', role: 'Development & IT',
    url: `https://example.com/jobs/${index}`, source: 'Layout fixture', salary: '', date: '', logo: '', workMode: 'Remote / WFH', description: 'Example description', direct: false,
  }));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Layout preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs, message: 'Local layout fixture', configured: true } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let resultDiv, host;
    window.drawGoogleCards = (count, noCursor = false, invalid = false) => {
      const query = window.layoutQuery;
      const results = Array.from({length:count}, (_,index) => ({title:index%2?'Medical Billing, Coding & Arbitration Specialist (Remote | US Client)':'Cashier',url:'https://www.onlinejobs.ph/jobseekers/job/layout-'+index,content:index%2?'Longer summary with additional job details. '.repeat(9):index===2?'':'Short summary.'}));
      if (invalid) results.push({title:'Advice article',url:'https://www.onlinejobs.ph/blog/advice',content:'Not a job-detail page'});
      window.__gcse.searchCallbacks.web.starting('joblink-google-jobs',query);
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs',query,[],results,resultDiv);
      window.__gcse.searchCallbacks.web.rendered();
      // Google creates its native footer AFTER the rendered callback.
      host.querySelector('.gsc-cursor-box')?.remove();
      if (!noCursor) {
        const footer = document.createElement('div');
        footer.className = 'gsc-cursor-box';
        footer.innerHTML='<div class="gsc-cursor">'+[1,2].map(number=>'<div role="button" tabindex="0" class="gsc-cursor-page '+(window.layoutPage===number?'gsc-cursor-current-page':'')+'">'+number+'</div>').join('')+'</div>';
        host.querySelector('.gsc-results').insertBefore(footer, host.querySelector('.gcsc-more-maybe-branding-root'));
        footer.querySelectorAll('.gsc-cursor-page').forEach(control => control.onclick=()=>{
          window.layoutPage=Number(control.textContent);
          window.drawGoogleCards(window.layoutPage===2?1:window.layoutPageSize);
        });
      }
    };
    const element={execute(query){window.layoutQuery=query;window.layoutPage=1;window.drawGoogleCards(window.layoutPageSize)},clearAllResults(){}};
    window.google={search:{cse:{element:{render(config){
      host=config.div;
      window.layoutPageSize=Number(config.attributes.webSearchResultSetSize)||10;
      // Emulate provider styles being added after the app's stylesheet.
      const style=document.createElement('style');
      style.textContent='.gsc-control-cse{font-family:Arial;font-size:13px;border:1px solid white;padding:1em;background:white}.gsc-control-cse .gsc-results{width:528px}.gsc-results .gsc-cursor-box .gsc-cursor-page{margin-right:8px;cursor:pointer;color:black;text-decoration:underline;background:white}.gsc-results .gsc-cursor-box .gsc-cursor-current-page{font-weight:bold;color:black;background:white}.gsc-results .gsc-cursor-box{margin:10px}';
      document.head.append(style);
      host.innerHTML='<div class="gsc-control-cse"><div class="gsc-results gsc-webResult"><div data-layout-organic></div><div class="gsc-cursor-box"><div class="gsc-cursor"><div role="button" tabindex="0" class="gsc-cursor-page gsc-cursor-current-page">1</div><div role="button" tabindex="0" class="gsc-cursor-page">2</div></div></div><div class="gcsc-more-maybe-branding-root">Enhanced by Google (fixture)</div></div></div>';
      resultDiv=host.querySelector('[data-layout-organic]');
      host.querySelectorAll('.gsc-cursor-page').forEach(control => control.onclick=()=>{
        host.querySelectorAll('.gsc-cursor-page').forEach(other=>other.classList.toggle('gsc-cursor-current-page',other===control));
        window.drawGoogleCards(control.textContent==='2'?1:10);
      });
    },getElement(){return element}}}}};
    window.__gcse.initializationCallback();
  ` }));

  async function checkLayout(selector, count) {
    await page.waitForFunction(({ selector, count }) => document.querySelector(selector)?.children.length === count, { selector, count });
    const result = await page.locator(selector).evaluate(grid => {
      const box = grid.getBoundingClientRect();
      const rows = [];
      for (const child of grid.children) {
        const card = child.matches('.job-card') ? child : child.querySelector('.job-card');
        const rect = card.getBoundingClientRect();
        const action = card.querySelector('[data-apply-job]').getBoundingClientRect();
        let row = rows.find(row => Math.abs(row.top - rect.top) < 2);
        if (!row) { row = { top: rect.top, cards: [] }; rows.push(row); }
        row.cards.push({ left: rect.left, right: rect.right, width: rect.width, height: rect.height, actionTop: action.top });
      }
      return { left: box.left, right: box.right, rows, trackWidth: parseFloat(getComputedStyle(grid).gridTemplateColumns), overflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    assert.equal(result.overflow, false, 'No horizontal page overflow');
    for (const row of result.rows) {
      assert.ok(Math.abs(row.cards[0].left - result.left) < 2, 'Every row starts at the panel edge');
      for (const [index, card] of row.cards.entries()) {
        assert.ok(Math.abs(card.width - result.trackWidth) < 2, 'Uniform columns, including incomplete rows');
        assert.ok(Math.abs(card.height - result.rows[0].cards[0].height) < 2, 'Equal card heights across rows');
        assert.ok(Math.abs(card.actionTop - row.cards[0].actionTop) < 2, 'Apply buttons align');
        if (index) assert.ok(Math.abs(card.left - row.cards[index - 1].right - 16) < 2, 'Consistent 16px gaps');
      }
    }
  }
  const metrics = node => {
    const style = getComputedStyle(node);
    return Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','padding','borderRadius','backgroundColor','color','borderWidth','borderColor'].map(key => [key,style[key]]));
  };
  await page.goto('/playground-job-card-layout');
  await page.locator('[data-ready=true]').waitFor();
  await checkLayout('[data-job-results]', 12);
  const feedPagination = await page.locator('[data-job-pagination]').getByRole('button', { name: 'Page 2', exact: true }).evaluate(metrics);
  const feedCurrent = await page.locator('[data-job-pagination] [aria-current=page]').evaluate(metrics);
  assert.equal(await page.locator('[data-job-pagination]').getByRole('button', { name: 'Previous page', exact: true }).count(), 0);
  await page.locator('#job-query').fill('developer');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await page.locator('.google-job-grid').waitFor();
  await checkLayout('.google-job-grid', 12);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 12 entries on page 1');
  assert.equal(await page.evaluate(() => window.layoutPageSize), 12, 'Google requests the same twelve-card page as feeds');
  const pairs = ['.job-card','.card-body','.avatar','.job-title','.job-title-link','.job-details-link','.job-card-identity .small','.job-card-metadata','.job-tag','.job-card-actions .btn-primary','.job-card-actions button'];
  for (const selector of pairs) {
    const feed = await page.locator('[data-job-results]').locator(selector).first().evaluate(metrics);
    const google = await page.locator('.google-job-grid').locator(selector).first().evaluate(metrics);
    assert.deepEqual(google, feed, selector + ' uses the same styling in both feeds');
  }
  assert.deepEqual(await page.locator('.gsc-cursor-page').nth(1).evaluate(metrics), feedPagination, 'Inactive page controls match');
  assert.deepEqual(await page.locator('.gsc-cursor-current-page').evaluate(metrics), feedCurrent, 'Active page controls match');
  const geometry = card => {
    const rect = card.getBoundingClientRect();
    return Object.fromEntries(['.avatar', '.job-title', '.job-details-link', '.job-card-metadata', '.job-card-actions'].map(selector => {
      const box = card.querySelector(selector).getBoundingClientRect();
      return [selector, { left: box.left - rect.left, top: box.top - rect.top, height: box.height }];
    }));
  };
  assert.deepEqual(await page.locator('.google-job-card').first().evaluate(geometry), await page.locator('[data-job-results] .job-card').first().evaluate(geometry), 'Google uses the same card sections and positions as feed cards');
  assert.equal(await page.locator('.google-job-card .google-job-preview').count(), 0);
  assert.equal(await page.locator('.gsc-cursor').getByRole('button', { name: 'Previous page', exact: true }).count(), 0);
  await page.locator('#job-source').selectOption('google');
  for (const width of [320, 390, 768, 1024, 1530]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const count of [1, 2, 4, 5, 7, 8, 10, 12]) {
      await page.evaluate(count => window.drawGoogleCards(count), count);
      await checkLayout('.google-job-grid', count);
      await page.waitForFunction(count => document.querySelector('[data-google-page-count]')?.textContent === 'Showing '+count+' '+(count===1?'entry':'entries')+' on page 1', count);
    }
    const footer = await page.locator('.gsc-cursor-box').evaluate(nav => {
      const rect = nav.getBoundingClientRect();
      const count = nav.querySelector('[data-google-page-count]').getBoundingClientRect();
      const pages = nav.querySelector('.pagination').getBoundingClientRect();
      return { left: count.left - rect.left, center: (pages.left + pages.right - rect.left - rect.right) / 2, alongside: Math.abs((pages.top + pages.bottom - count.top - count.bottom) / 2), below: count.top >= pages.bottom, overflow: nav.scrollWidth > nav.clientWidth };
    });
    assert.ok(Math.abs(footer.left) < 2, 'Google count starts at the bottom-left of the results');
    assert.ok(Math.abs(footer.center) < 2, 'Google page controls stay centered');
    assert.equal(footer.overflow, false);
    if (width < 768) assert.equal(footer.below, true);
    else assert.ok(footer.alongside < 2, 'Google count is alongside the paginator');
    console.log('PASS layout width', width);
  }
  await page.locator('.gsc-cursor-page').nth(1).click();
  await checkLayout('.google-job-grid', 1);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 1 entry on page 2');
  assert.equal(await page.locator('.gsc-cursor-page').nth(1).getAttribute('aria-current'), 'page');
  await page.locator('.gsc-cursor').getByRole('button', { name: 'Previous page', exact: true }).click();
  await checkLayout('.google-job-grid', 12);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 12 entries on page 1');
  assert.equal(await page.locator('.gsc-cursor').getByRole('button', { name: 'Previous page', exact: true }).count(), 0);
  await page.locator('.google-job-card [data-job-details]').first().click();
  await page.locator('[data-job-details-modal]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-details-description]').innerText(), /Short summary/);
  await page.getByRole('button', { name: 'Close job details', exact: true }).click();
  await page.locator('.google-job-card [data-job-pick]').first().check();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /1 selected/);
  await page.locator('[data-job-clear-selection]').click();
  await page.evaluate(() => window.drawGoogleCards(2, false, true));
  await checkLayout('.google-job-grid', 2);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 2 entries on page 1');
  await page.evaluate(() => window.drawGoogleCards(1, true));
  await checkLayout('.google-job-grid', 1);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 1 entry on page 1');
  assert.equal(await page.locator('.gsc-cursor').count(), 0, 'A single Google page still has an entry count');
  await page.evaluate(() => window.drawGoogleCards(0, true));
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 0 entries on page 1');
  await page.locator('#job-source').selectOption('jobicy');
  await page.locator('[data-google-jobs]').waitFor({ state: 'hidden' });
  await checkLayout('[data-job-results]', 12);
  for (const width of [320, 390, 768, 1024, 1530]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkLayout('[data-job-results]', 12);
  }
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await checkLayout('[data-job-results]', 1);
  await page.locator('[data-job-pagination]').getByRole('button', { name: 'Previous page', exact: true }).click();
  await checkLayout('[data-job-results]', 12);
  assert.equal(await page.locator('[data-job-pagination]').getByRole('button', { name: 'Previous page', exact: true }).count(), 0);
  assert.deepEqual(errors, [], 'No browser errors');
  console.log('PASS: shared card typography, logos, controls and pagination; source switching; details; selection; native Google paging; responsive grids and incomplete rows.');
} finally {
  await browser?.close();
  await unlink(preview);
}
