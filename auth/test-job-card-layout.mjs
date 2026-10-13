import assert from 'node:assert/strict';
import { mockOpenAvailability } from './job-availability-fixture.mjs';
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
  await mockOpenAvailability(context);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const jobs = Array.from({ length: 13 }, (_, index) => ({
    id: `layout-${index}`, title: index % 2 ? 'Medical Billing, Coding & Arbitration Specialist (Remote | US Client)' : 'Cashier',
    company: index === 1 ? 'Example company with a very long international employer name' : 'Example company',
    location: index === 1 ? 'Remote · Available from Manila, Cebu and Davao' : index === 0 ? 'Remote' : 'Philippines',
    employmentType: index === 2 ? 'Part-time' : 'Full-time', role: index === 2 ? 'Finance & operations' : 'Development & IT',
    url: `https://example.com/jobs/${index}`, source: 'Layout fixture',
    salary: index === 1 ? '$80,000 – $120,000 per year plus performance bonus and benefits' : '',
    date: index === 0 ? new Date().toISOString() : index === 1 ? '2020-01-01' : '',
    logo: '', workMode: 'Remote / WFH', description: 'Example description', direct: index === 1,
  }));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Layout preview', email: 'preview@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: new URL(route.request().url()).searchParams.get('q') === 'cashier' ? jobs.slice(0, 1) : jobs, message: 'Local layout fixture', configured: true } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let resultDiv, host;
    window.drawGoogleCards = (count, noCursor = false, invalid = false) => {
      const query = window.layoutQuery;
      const results = Array.from({length:count}, (_,index) => ({title:index%2?'Medical Billing, Coding & Arbitration Specialist (Remote | US Client)':'Cashier',url:'https://www.onlinejobs.ph/jobseekers/job/layout-'+index,content:index%2?'Remote role in Davao. Longer summary with additional job details. '.repeat(9):index===2?'Remote, Davao':'Remote role in Davao. Short summary.'}));
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
    const element={execute(query){window.layoutQuery=query;window.layoutPage=1;if(!window.layoutHold)window.drawGoogleCards(window.layoutPageSize)},clearAllResults(){}};
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
      if (grid.closest('[data-job-combined]')) grid = grid.closest('.job-results-body');
      const box = grid.getBoundingClientRect();
      const style = getComputedStyle(grid);
      const rows = [];
      for (const card of grid.querySelectorAll('.job-card')) {
        const rect = card.getBoundingClientRect();
        const action = card.querySelector('[data-apply-job]').getBoundingClientRect();
        const footer = card.querySelector('.job-card-footer').getBoundingClientRect();
        const secondary = Array.from(card.querySelectorAll('.job-card-secondary-actions .btn'), button => {
          const box = button.getBoundingClientRect();
          const label = button.querySelector('.job-card-button-label');
          return { left: box.left, right: box.right, top: box.top, height: box.height, clipped: label.scrollWidth > label.clientWidth, text: label.textContent, labelWidth: label.clientWidth, textWidth: label.scrollWidth };
        });
        let row = rows.find(row => Math.abs(row.top - rect.top) < 2);
        if (!row) { row = { top: rect.top, cards: [] }; rows.push(row); }
        row.cards.push({ left: rect.left, right: rect.right, width: rect.width, height: rect.height, actionTop: action.top, actionLeft: action.left, actionRight: action.right, footerLeft: footer.left, footerRight: footer.right, secondary, icons: card.querySelectorAll('.job-card-button-icon svg').length });
      }
      return { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight), rows, trackWidth: parseFloat(style.gridTemplateColumns), overflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    assert.equal(result.overflow, false, 'No horizontal page overflow');
    for (const row of result.rows) {
      assert.ok(Math.abs(row.cards[0].left - result.left) < 2, 'Every row starts at the panel edge');
      for (const [index, card] of row.cards.entries()) {
        assert.ok(Math.abs(card.width - result.trackWidth) < 2, 'Uniform columns, including incomplete rows');
        assert.ok(Math.abs(card.height - result.rows[0].cards[0].height) < 2, 'Equal card heights across rows');
        assert.ok(Math.abs(card.actionTop - row.cards[0].actionTop) < 2, 'Apply buttons align');
        assert.ok(Math.abs(card.actionLeft - card.footerLeft) < 1 && Math.abs(card.actionRight - card.footerRight) < 1, 'Apply fills the card action area');
        assert.equal(card.secondary.length, 3);
        assert.equal(card.icons, 4, 'Each action has its matching shared icon');
        assert.ok(Math.abs(card.secondary[0].left - card.actionLeft) < 1 && Math.abs(card.secondary[2].right - card.actionRight) < 1, 'Secondary actions fill the same width as Apply');
        for (const button of card.secondary) {
          assert.ok(Math.abs(button.top - card.secondary[0].top) < 1 && Math.abs(button.height - card.secondary[0].height) < 1, 'All three secondary actions remain in one aligned row');
          assert.equal(button.clipped, false, `${button.text} remains readable on narrow cards (${button.labelWidth}px available, ${button.textWidth}px text)`);
        }
        if (index) assert.ok(Math.abs(card.left - row.cards[index - 1].right - 16) < 2, 'Consistent 16px gaps');
      }
    }
  }
  async function checkSharedCardSections() {
    const cards = await page.locator('.job-card:visible').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      const positions = Object.fromEntries(['.job-card-header', '.job-title', '.job-details-link', '.job-card-metadata', '.job-card-source p', '.job-card-footer'].map(selector => [selector, card.querySelector(selector).getBoundingClientRect().top - rect.top]));
      const overflow = card.scrollWidth > card.clientWidth || card.querySelector('.card-body').scrollWidth > card.querySelector('.card-body').clientWidth;
      return { height: rect.height, positions, overflow };
    }));
    for (const card of cards) {
      assert.equal(card.overflow, false, 'Long company names, tags and action labels stay inside the card');
      assert.ok(Math.abs(card.height - cards[0].height) < 1, 'Card heights match across sources and filtered result counts');
      for (const [selector, top] of Object.entries(card.positions)) assert.ok(Math.abs(top - cards[0].positions[selector]) < 1, selector + ' stays aligned across titles, salaries and New badges');
    }
  }
  async function checkContinuousGrid() {
    const layout = await page.locator('.job-results-body').evaluate(body => {
      const cards = Array.from(body.querySelectorAll('.job-card'), card => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      });
      const style = getComputedStyle(body), box = body.getBoundingClientRect();
      const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
      const columns = Math.max(1, Math.round((right - left + 16) / (cards[0].width + 16)));
      const footers = Array.from(body.querySelectorAll('[data-job-pagination], .gsc-cursor-box')).filter(footer => footer.getBoundingClientRect().height > 0).map(footer => footer.getBoundingClientRect().top);
      const feedFooter = body.querySelector('[data-job-pagination]');
      const controlsFollowCards = Array.from(body.querySelectorAll('.job-card')).every(card => card.compareDocumentPosition(feedFooter) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { cards, columns, left, footers, controlsFollowCards };
    });
    for (const [index, card] of layout.cards.entries()) {
      const column = index % layout.columns;
      assert.ok(Math.abs(card.left - (layout.left + column * (card.width + 16))) < 2, 'Google jobs fill the next available column after feed jobs');
      if (column) assert.ok(Math.abs(card.top - layout.cards[index - column].top) < 2, 'Feed and Google cards share the same row');
      else if (index) assert.ok(Math.abs(card.top - layout.cards[index - 1].bottom - 16) < 2, 'Rows have one consistent gap across sources');
    }
    assert.ok(layout.footers.every(top => top >= Math.max(...layout.cards.map(card => card.bottom)) + 15), 'All page controls appear below the full card grid');
    assert.equal(layout.controlsFollowCards, true, 'Keyboard order visits all cards before the feed page controls');
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
  await page.locator('#job-query').fill('cashier, medical');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await page.locator('.google-job-card').first().waitFor();
  await checkLayout('.google-job-grid', 12);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 12 entries on page 1');
  assert.equal(await page.evaluate(() => window.layoutPageSize), 12, 'Google requests the same twelve-card page as feeds');
  const pairs = ['.job-card','.card-body','.avatar','.job-title','.job-title-link','.job-details-link','.job-card-identity .small','.job-card-metadata','.job-tag','.job-card-actions .btn-primary','.job-card-action-applied','.job-card-action-save','.job-card-action-unavailable'];
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
  const unfilteredHeight = await page.locator('[data-job-results] .job-card').first().evaluate(card => card.getBoundingClientRect().height);
  await page.locator('#job-location').fill('Remote');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await checkLayout('[data-job-results]', 2);
  await checkLayout('.google-job-grid', 12);
  await page.evaluate(() => window.drawGoogleCards(4));
  await checkLayout('.google-job-grid', 4);
  await checkContinuousGrid();
  await page.evaluate(() => { window.layoutHold = true; document.querySelector('[data-job-search]').requestSubmit(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-google-jobs-preview] .google-job-card').length === 4);
  await checkContinuousGrid();
  await page.evaluate(() => { window.layoutHold = false; window.drawGoogleCards(4); });
  await page.waitForFunction(() => document.querySelectorAll('[data-google-jobs-preview] .google-job-card').length === 0);
  await checkLayout('.google-job-grid', 4);
  await checkContinuousGrid();
  await page.evaluate(() => window.drawGoogleCards(3));
  await checkLayout('.google-job-grid', 3);
  await checkSharedCardSections();
  assert.equal(await page.locator('[data-job-results] [data-job-new]').count(), 1, 'Mixed fresh and older cards have aligned source rows');
  assert.equal(await page.locator('[data-job-results] .job-card').first().evaluate(card => card.getBoundingClientRect().height), unfilteredHeight, 'Filtering does not change the card height at the same width');
  const longCard = page.locator('[data-job-card="layout-1"]');
  assert.equal(await longCard.locator('.job-card-identity > :first-child').getAttribute('title'), jobs[1].company);
  assert.equal(await longCard.locator('[data-job-location]').getAttribute('title'), jobs[1].location);
  assert.equal(await longCard.locator('.job-card-tags').last().locator('.job-tag').getAttribute('title'), jobs[1].salary, 'Full salary remains available when its tag is shortened');
  await longCard.locator('.job-title-link').click();
  await page.locator('[data-job-details-modal]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-details-company]').innerText(), jobs[1].company);
  assert.ok((await page.locator('[data-details-tags]').innerText()).includes(jobs[1].salary), 'Full salary is readable in job details on mobile as well as desktop');
  assert.ok((await page.locator('[data-details-tags]').innerText()).includes(jobs[1].location), 'Full location is readable in job details');
  await page.getByRole('button', { name: 'Close job details', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1530]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkLayout('[data-job-results]', 2);
    await checkLayout('.google-job-grid', 3);
    await checkContinuousGrid();
    await checkSharedCardSections();
  }
  if (process.env.JOBLINK_LAYOUT_SCREENSHOT) {
    await page.locator('#job-results-title').click();
    await page.locator('.job-results-panel').screenshot({ path: process.env.JOBLINK_LAYOUT_SCREENSHOT });
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.locator('[data-job-results] .job-card').first().screenshot({ path: process.env.JOBLINK_LAYOUT_SCREENSHOT.replace(/\.png$/, '-mobile.png'), animations: 'disabled', style: '.jobify-sidebar, .joblink-assistant { visibility: hidden !important; }' });
    await page.setViewportSize({ width: 1530, height: 1000 });
    const theme = await page.locator('html').getAttribute('data-bs-theme');
    await page.locator('html').evaluate(html => html.setAttribute('data-bs-theme', 'dark'));
    await page.locator('[data-job-results] .job-card').first().screenshot({ path: process.env.JOBLINK_LAYOUT_SCREENSHOT.replace(/\.png$/, '-dark.png'), animations: 'disabled', style: '.joblink-assistant { visibility: hidden !important; }' });
    await page.locator('html').evaluate((html, theme) => theme === null ? html.removeAttribute('data-bs-theme') : html.setAttribute('data-bs-theme', theme), theme);
  }
  await page.locator('#job-location').fill('Davao');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await checkLayout('[data-job-results]', 1);
  await checkLayout('.google-job-grid', 12);
  await checkSharedCardSections();
  assert.equal(await page.locator('[data-job-results] .job-card').first().evaluate(card => card.getBoundingClientRect().height), unfilteredHeight, 'An isolated older listing retains the same height');
  await page.locator('#job-location').fill('');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await checkLayout('[data-job-results]', 12);
  for (const [selector, value, count] of [['#job-employment', 'Part-time', 1], ['#job-classification', 'Finance & operations', 1], ['#job-listing-time', '7', 1]]) {
    await page.locator(selector).selectOption(value);
    await checkLayout('[data-job-results]', count);
    await checkLayout('.google-job-grid', 12);
    await checkSharedCardSections();
    await page.locator(selector).selectOption('');
    await checkLayout('[data-job-results]', 12);
  }
  await page.locator('#job-query').fill('cashier');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await checkLayout('[data-job-results]', 1);
  await checkLayout('.google-job-grid', 6);
  await checkSharedCardSections();
  await page.locator('#job-query').fill('cashier, medical');
  await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
  await checkLayout('[data-job-results]', 12);
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
  await page.locator('[data-job-select-all]').uncheck();
  await page.evaluate(() => window.drawGoogleCards(2, false, true));
  await checkLayout('.google-job-grid', 2);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 2 entries on page 1');
  await page.evaluate(() => window.drawGoogleCards(1, true));
  await checkLayout('.google-job-grid', 1);
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 1 entry on page 1');
  assert.equal(await page.locator('.gsc-cursor').count(), 0, 'A single Google page still has an entry count');
  await page.evaluate(() => window.drawGoogleCards(0, true));
  await page.waitForFunction(() => document.querySelector('[data-google-page-count]')?.textContent === 'Showing 0 entries on page 1');
  assert.equal(await page.locator('.gsc-cursor-box').isVisible(), false, 'A genuinely empty Google page has no stale page controls');
  assert.equal(await page.locator('[data-job-selection-toolbar]').isVisible(), false);
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
  console.log('PASS: continuous feed/Google rows, cached previews, shared card alignment, filtering, source switching, details, selection, native Google paging, keyboard order and responsive grids.');
} finally {
  await browser?.close();
  await unlink(preview);
}
