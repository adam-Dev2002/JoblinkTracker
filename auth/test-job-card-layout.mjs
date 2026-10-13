import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';

const preview = new URL('../jobfinder/preview/pages/playground-job-card-layout.astro', import.meta.url);
await writeFile(preview, "---\nimport WorkspacePage from '../components/workspace/WorkspacePage.astro'\n---\n<WorkspacePage view=\"jobs\" title=\"Find work\" description=\"Unified job card layout\" />\n", { flag: 'wx' });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.JOBLINK_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true });
  const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000', viewport: { width: 1530, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const legal = { id: 'legal-feed', title: 'Commercial Legal Counsel', company: 'Talacale', location: 'Remote', employmentType: 'Full-time', role: 'Other roles', url: 'https://jobs.lever.co/talacale/counsel', source: 'Fixture feed', salary: 'CAD 130,000 – 170,000 yearly', date: new Date().toISOString(), logo: '', workMode: 'Remote / WFH', description: 'Commercial legal counsel.', direct: false };
  const feeds = Array.from({ length: 13 }, (_, i) => ({ ...legal, id: 'software-' + i, title: i % 2 ? 'Senior Software Developer for a long international company name' : 'Software Developer', company: 'Example company ' + i, url: 'https://example.com/jobs/' + i, location: i % 2 ? 'Philippines' : 'Remote', employmentType: i % 3 ? 'Full-time' : 'Part-time', role: i === 2 ? 'Finance & operations' : 'Development & IT', salary: i % 2 ? '' : '$80,000 – $120,000 yearly', date: i === 1 ? '2020-01-01' : legal.date }));
  const legalGoogle = Array.from({ length: 6 }, (_, i) => ({ title: i % 2 ? 'Commercial Legal Counsel at an international technology company' : 'Corporate Paralegal & Legal Operations', url: 'https://www.onlinejobs.ph/jobseekers/job/legal-' + (10000 + i), content: 'Remote commercial legal counsel, full-time role.' }));
  const softwareGoogle = Array.from({ length: 16 }, (_, i) => ({ title: i % 2 ? 'Senior Software Developer for a long international company name' : 'Software Developer', url: 'https://www.linkedin.com/jobs/view/software-' + (20000 + i), content: 'Remote software developer, full-time or part-time finance and technology work.' }));
  await context.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 1, name: 'Layout fixture', email: 'layout@example.invalid', provider: 'email', avatarUrl: null }, csrf: 'fixture', googleEnabled: false } }));
  await context.route('**/api/workspace/items', route => route.fulfill({ json: { items: [] } }));
  await context.route('**/api/jobs/search*', route => route.fulfill({ json: { jobs: new URL(route.request().url()).searchParams.get('q')?.toLowerCase().includes('commercial') ? [legal] : feeds, message: 'Layout fixture' } }));
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort());
  await context.route('https://cse.google.com/cse.js?cx=*', route => route.fulfill({ contentType: 'application/javascript', body:
    "let host, organic, query, resultPages;\n" +
    "const legal = " + JSON.stringify(legalGoogle) + "; const software = " + JSON.stringify(softwareGoogle) + ";\n" +
    "const duplicate = " + JSON.stringify({ title: 'Commercial Legal Counsel indexed duplicate', url: legal.url + '?utm_source=google', content: 'Remote commercial legal counsel, full-time role.' }) + ";\n" +
    "window.providerRequests=[];\n" +
    "const draw=number=>{window.providerRequests.push(number);window.__gcse.searchCallbacks.web.starting('joblink-google-jobs',query);window.__gcse.searchCallbacks.web.ready('joblink-google-jobs',query,[],resultPages[number-1],organic);window.__gcse.searchCallbacks.web.rendered();host.querySelector('.gsc-cursor-box')?.remove();const cursor=document.createElement('div');cursor.className='gsc-cursor-box';cursor.innerHTML='<div class=\"gsc-cursor\">'+resultPages.map((_,i)=>'<div class=\"gsc-cursor-page '+(i+1===number?'gsc-cursor-current-page':'')+'\">'+(i+1)+'</div>').join('')+'</div>';host.querySelector('.gsc-results').append(cursor);cursor.querySelectorAll('.gsc-cursor-page').forEach((control,i)=>control.onclick=()=>draw(i+1));};\n" +
    "const element={execute(value){query=value;resultPages=value.toLowerCase().includes('commercial legal counsel')?[[duplicate,...legal]]:[software.slice(0,12),software.slice(12)];draw(1);},clearAllResults(){}};\n" +
    "window.google={search:{cse:{element:{render(config){host=config.div;host.innerHTML='<div class=\"gsc-control-cse\"><div class=\"gsc-control-wrapper-cse\"><div class=\"gsc-results-wrapper-visible\"><div class=\"gsc-wrapper\"><div class=\"gsc-resultsbox-visible\"><div class=\"gsc-results gsc-webResult\"><div class=\"gsc-expansionArea\"><div class=\"gsc-webResult gsc-result\"><table><tbody><tr><td><div data-organic></div></td></tr></tbody></table></div></div><div class=\"gcsc-more-maybe-branding-root\">Enhanced by Google (fixture)</div><div class=\"gs-result\"><div class=\"gs-spelling\">Showing results for internal site: query</div></div></div></div></div></div></div></div>';organic=host.querySelector('[data-organic]');const style=document.createElement('style');style.textContent='.gsc-control-cse{font-family:Arial;font-size:13px;padding:1em;background:white}.gsc-control-cse .gsc-results{width:528px}.gsc-cursor-box{margin:10px}.gsc-cursor-page{display:inline-block;margin:8px}';document.head.append(style);},getElement(){return element;}}}}};window.__gcse.initializationCallback();"
  }));
  const search = async value => {
    await page.locator('#job-query').fill(value);
    await page.locator('[data-job-search]').evaluate(form => form.requestSubmit());
    await page.locator('[data-job-search][aria-busy="false"]').waitFor();
    await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
    await page.waitForFunction(() => !document.querySelector('[data-job-results] .data-placeholder'));
  };
  async function checkGrid(count) {
    await page.waitForFunction(count => document.querySelectorAll('[data-job-results] .job-card').length === count, count);
    assert.equal(await page.locator('[data-google-jobs-host] .job-card').count(), 0, 'Provider wrappers cannot own cards or create grid cells');
    assert.equal(await page.locator('.gsc-cursor-box:visible').count(), 0, 'Native pagination is hidden');
    assert.equal(await page.locator('.workspace-pagination:visible').count(), count ? 1 : 0, 'Exactly one count and pager');
    const layout = await page.locator('[data-job-results]').evaluate(grid => {
      const box = grid.getBoundingClientRect(), style = getComputedStyle(grid);
      const width = parseFloat(style.gridTemplateColumns), columns = style.gridTemplateColumns.split(' ').length;
      const cards = [...grid.querySelectorAll('.job-card')].map(card => {
        const rect = card.getBoundingClientRect();
        const footer = card.querySelector('.job-card-footer').getBoundingClientRect();
        return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, footer: footer.top - rect.top, overflow: card.scrollWidth > card.clientWidth };
      });
      return { left: box.left, columns, width, cards, pager: document.querySelector('[data-job-pagination]').getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(layout.overflow, false);
    for (const [i, card] of layout.cards.entries()) {
      const column = i % layout.columns;
      assert.ok(Math.abs(card.left - layout.left - column * (layout.width + 16)) < 2, 'No empty columns between sources');
      assert.ok(Math.abs(card.width - layout.width) < 2, 'Every source uses the same column width');
      assert.ok(Math.abs(card.height - layout.cards[0].height) < 2, 'Cards have consistent heights');
      assert.ok(Math.abs(card.footer - layout.cards[0].footer) < 2, 'Actions align across sources');
      assert.equal(card.overflow, false);
      if (column) assert.ok(Math.abs(card.top - layout.cards[i - column].top) < 2, 'One continuous row');
      else if (i) assert.ok(Math.abs(card.top - layout.cards[i - 1].bottom - 16) < 2, 'One consistent gap between rows');
    }
    if (count) assert.ok(layout.pager >= Math.max(...layout.cards.map(card => card.bottom)) + 15);
  }
  await page.goto('/playground-job-card-layout');
  await page.locator('[data-ready=true]').waitFor();
  await checkGrid(12);
  await search('Commercial Legal Counsel');
  await checkGrid(7);
  assert.equal(await page.locator('[data-job-count]').innerText(), '7 results');
  assert.equal(await page.getByRole('button', { name: 'Commercial Legal Counsel indexed duplicate', exact: true }).count(), 0, 'One posting across sources has one card');
  for (const width of [1530, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkGrid(7);
  }
  await page.setViewportSize({ width: 1530, height: 1000 });
  if (process.env.JOBLINK_LAYOUT_SCREENSHOT) await page.locator('.job-results-panel').screenshot({ path: process.env.JOBLINK_LAYOUT_SCREENSHOT });
  for (const [selector, value] of [['#job-employment', 'Full-time'], ['#job-classification', 'Other roles'], ['#job-listing-time', '7']]) {
    await page.locator(selector).selectOption(value);
    await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
    await checkGrid(7);
    await page.locator(selector).selectOption('');
  }
  await page.locator('#job-location').fill('Remote');
  await search('Commercial Legal Counsel');
  await checkGrid(7);
  await page.locator('#job-location').fill('Nowhere unavailable');
  await search('Commercial Legal Counsel');
  await page.locator('[data-job-empty]').waitFor();
  await checkGrid(0);
  await page.locator('#job-location').fill('');
  await search('Software Developer');
  await checkGrid(12);
  await page.locator('[data-job-pagination]').getByRole('button', { name: 'Next page', exact: true }).click();
  await checkGrid(12);
  assert.equal(await page.locator('[data-job-results] .google-job-card').count(), 11, 'The second combined page contains the final feed job and Google jobs');
  await page.locator('[data-job-pagination]').getByRole('button', { name: 'Next page', exact: true }).click();
  await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
  await checkGrid(5);
  assert.equal(await page.locator('[data-job-count]').innerText(), '29 results');
  await page.locator('#job-source').selectOption('google');
  await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
  await checkGrid(12);
  await page.locator('[data-job-entries]').selectOption('all');
  await page.locator('[data-google-jobs][aria-busy="false"]').waitFor({ state: 'attached' });
  await checkGrid(16);
  await page.locator('[data-job-select-all]').check();
  assert.equal(await page.locator('[data-job-pick]:checked').count(), 16);
  await page.locator('[data-job-select-all]').uncheck();
  await page.locator('[data-job-entries]').selectOption('12');
  await page.locator('#job-source').selectOption('all');
  await search('Commercial Legal Counsel');
  await checkGrid(7);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await checkGrid(7);
  assert.deepEqual(errors, []);
  console.log('PASS: one actual card grid/pager, realistic provider wrappers, exact page sizes, cross-source deduplication, sparse rows, all filters, source switches, provider-backed Next, All entries, selection, reload and 320–1530px layouts.');
} finally {
  await browser?.close();
  await unlink(preview);
}
