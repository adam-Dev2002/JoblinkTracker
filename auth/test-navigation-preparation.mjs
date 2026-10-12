import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs';
import { prerenderBrowser } from './prerender-browser-fixture.mjs';

// Use an HTTP fixture rather than request interception: prerender runs in a
// separate browser target. All APIs stay local and never change an account.
const upstream = process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000';
const fixturePrefix = `playground-navigation-${process.pid}`;
const views = { '/dashboard': 'dashboard', '/applications': 'applications', '/desk/sheet': 'sheet', '/job-listing': 'jobs' };
const created = [];
let browser, native, server;
let reads = 0, writes = 0, signedIn = true;
let records = Array.from({ length: 14 }, (_, index) => ({ id: index + 1, kind: 'application', attachments: [], payload: { title: `Navigation role ${index}`, company: 'Example', status: 'Saved', date: '2026-10-12', url: `https://example.com/jobs/${index}`, notes: '' } }));
const documents = [];
const preparedStates = new Map();
const waitFor = async predicate => {
  const deadline = Date.now() + 15000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw Error('Timed out waiting for prepared page');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
try {
  for (const view of Object.values(views)) {
    const file = new URL(`../jobfinder/preview/pages/${fixturePrefix}-${view}.astro`, import.meta.url);
    await writeFile(file, `---\nimport WorkspacePage from '../components/workspace/WorkspacePage.astro'\n---\n<WorkspacePage view="${view}" title="${view}" description="Navigation preparation fixture" />\n`, { flag: 'wx' });
    created.push(file);
  }
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://fixture').pathname;
      const json = data => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
      if (path === '/fixture-prepared-state') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const state = JSON.parse(body);
        preparedStates.set(state.path, state);
        return json({ ok: true });
      }
      if (path === '/api/auth/session') return json({ user: signedIn ? { id: 1, name: 'Navigation fixture', email: 'fixture@example.invalid', provider: 'email', avatarUrl: null } : null, csrf: 'fixture', googleEnabled: false });
      if (path === '/api/workspace/items') {
        if (request.method !== 'GET') { writes++; response.writeHead(405); return response.end(); }
        reads++;
        const snapshot = structuredClone(records);
        await new Promise(resolve => setTimeout(resolve, 1100));
        return json({ items: snapshot });
      }
      if (path === '/api/jobs/search') return json({ jobs: [], message: '' });
      if (path === '/api/assistant/status') return json({ enabled: false });
      if (path.startsWith('/api/')) { response.writeHead(404); return response.end(); }
      const view = views[path];
      if (view) documents.push({ path, purpose: request.headers['sec-purpose'] || '' });
      const result = await fetch(upstream + (view ? `/${fixturePrefix}-${view}` : request.url));
      const headers = Object.fromEntries(result.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      if (view) headers['cache-control'] = 'no-store';
      response.writeHead(result.status, headers);
      if (view) {
        // Observe hidden documents through this local fixture, without a
        // debugger attachment that could prevent browser preparation.
        const observation = `<script>if(document.prerendering){const watch=setInterval(()=>{if(!document.querySelector('[data-ready="true"]'))return;clearInterval(watch);fetch('/fixture-prepared-state',{method:'POST',body:JSON.stringify({path:location.pathname,rules:document.querySelectorAll('script[type="speculationrules"]').length,pending:Boolean(sessionStorage.getItem('jobify-pending-application')),dialogHidden:document.querySelector('[data-job-details-modal]').classList.contains('d-none')})})},50)}</script>`;
        response.end((await result.text()).replace('</body>', observation + '</body>'));
      } else response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = await prerenderBrowser();
  await native.navigate(origin + '/dashboard');
  await waitFor(() => native.evaluate(`Boolean(document.querySelector('[data-workspace-view][data-ready="true"]') && document.querySelector('script[type="speculationrules"]'))`));
  await native.allow();
  const before = reads;
  const link = '.sidebar-link[href="/applications"]';
  await native.pointer(link);
  try { await waitFor(() => documents.some(doc => doc.path === '/applications' && doc.purpose.includes('prerender')) && reads > before); }
  catch (error) { console.log({ documents, reads, before, errors: native.errors }); throw error; }
  await new Promise(resolve => setTimeout(resolve, 1400));
  await waitFor(() => preparedStates.has('/applications'));
  assert.equal(preparedStates.get('/applications').rules, 0, 'Hidden pages do not prepare further destinations');
  records[0].payload.title = 'Updated after preparation';
  const preparedRequests = documents.filter(doc => doc.path === '/applications').length;
  const start = Date.now();
  await native.pointer(link, true);
  await waitFor(() => native.evaluate(`location.pathname === '/applications' && Boolean(document.querySelector('[data-workspace-view][data-ready="true"]'))`));
  const elapsed = Date.now() - start;
  const activationStart = await native.evaluate(`performance.getEntriesByType('navigation')[0].activationStart`);
  assert.ok(activationStart > 0, 'Browser should activate the prepared document');
  assert.ok(elapsed < 900, `Prepared navigation took ${elapsed}ms despite a 1100ms API`);
  assert.equal(documents.filter(doc => doc.path === '/applications').length, preparedRequests, 'Click should reuse the prepared HTML');
  await native.evaluate(`document.querySelector('[data-application-all]').click()`);
  assert.equal(await native.evaluate(`document.querySelectorAll('[data-application-pick]:checked').length`), 10, 'Page selection still works after activation');
  await waitFor(() => native.evaluate(`document.querySelector('[data-application-rows]').textContent.includes('Updated after preparation')`));
  assert.equal(await native.evaluate(`document.querySelectorAll('[data-application-pick]:checked').length`), 10, 'Background reconciliation keeps row selection');
  // A new source-page edit must evict any prepared destination.
  await native.pointer('.sidebar-link[href="/desk/sheet"]');
  await waitFor(() => documents.some(doc => doc.path === '/desk/sheet' && doc.purpose.includes('prerender')));
  await native.evaluate(`window.dispatchEvent(new Event('joblink-workspace-changed'))`);
  assert.equal(await native.evaluate(`document.querySelectorAll('script[type="speculationrules"]').length`), 0);
  // Preparation must leave one-time job dialogs pending until the visit.
  const pendingJob = { id: 'pending-job', title: 'Pending developer', company: 'Example', url: 'https://example.com/jobs/pending', source: 'Test', location: 'Manila', description: 'Pending job details', salary: '', date: '2026-10-12', employmentType: 'Full-time', role: 'Development & IT', workMode: 'Remote', logo: '', direct: false };
  await native.evaluate(`sessionStorage.setItem('jobify-pending-application', ${JSON.stringify(JSON.stringify(pendingJob))})`);
  await native.pointer('.sidebar-link[href="/job-listing"]');
  await waitFor(() => documents.some(doc => doc.path === '/job-listing' && doc.purpose.includes('prerender')));
  await new Promise(resolve => setTimeout(resolve, 1400));
  await waitFor(() => preparedStates.has('/job-listing'));
  assert.equal(preparedStates.get('/job-listing').pending, true);
  assert.equal(preparedStates.get('/job-listing').dialogHidden, true);
  await native.pointer('.sidebar-link[href="/job-listing"]', true);
  await waitFor(() => native.evaluate(`location.pathname === '/job-listing' && document.body.classList.contains('job-details-open')`));
  assert.equal(await native.evaluate(`sessionStorage.getItem('jobify-pending-application')`), null, 'The dialog is consumed once on activation');
  // Signing out removes speculation rather than preparing protected pages.
  signedIn = false;
  await native.evaluate(`window.dispatchEvent(new CustomEvent('jobify-session', { detail: null }))`);
  await waitFor(() => native.evaluate(`location.pathname === '/sign-in'`));
  assert.equal(writes, 0, 'Preparation must never create or modify workspace rows');
  assert.deepEqual(native.errors, []);
  console.log(`Prepared navigation activated in ${elapsed}ms; selection, background reconciliation, edit invalidation, pending job dialog and logout passed.`);
  await native.close(); native = null;
  // Browsers without speculation rules retain normal working links/prefetch.
  signedIn = true;
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const fallback = await browser.newContext({ baseURL: origin });
  await fallback.addInitScript(() => { HTMLScriptElement.supports = () => false; });
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto('/dashboard');
  await fallbackPage.locator('[data-workspace-view][data-ready="true"]').waitFor();
  assert.equal(await fallbackPage.locator('script[type="speculationrules"]').count(), 0);
  await fallbackPage.locator('.sidebar-link[href="/applications"]').click();
  await fallbackPage.locator('[data-workspace-view="applications"][data-ready="true"]').waitFor();
  assert.match(await fallbackPage.locator('[data-application-rows]').innerText(), /Navigation role/);
  console.log('Fallback navigation and cached workspace passed.');
} finally {
  await native?.close();
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await Promise.all(created.map(file => unlink(file)));
}
