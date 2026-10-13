import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest } from '../jobfinder/node_modules/playwright/index.mjs';
import { loadEnv } from '../jobfinder/node_modules/vite/dist/node/index.js';

for (const [key, value] of Object.entries(loadEnv('development', fileURLToPath(new URL('../jobfinder/preview/', import.meta.url)), ''))) process.env[key] ??= value;
assert.equal(process.env.JOBLINK_BACKEND, 'supabase', 'This integration test uses the cloud backend');
const { handleApi } = await import('../jobfinder/preview/server/index.mjs');
const { db, query } = await import('../jobfinder/preview/server/core.mjs');
const baseURL = process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000';
const accounts = [], contexts = [], realFetch = globalThis.fetch;
let release, sourceReached;
const sourceStarted = new Promise(resolve => { sourceReached = resolve; });
const sourceGate = new Promise(resolve => { release = resolve; });
const unique = Date.now(), source = number => `https://www.onlinejobs.ph/jobseekers/job/salary-api-${unique + number}`;
const fetches = [];
try {
  for (const index of [0, 1]) {
    const client = await playwrightRequest.newContext({ baseURL });
    contexts.push(client);
    const session = await (await client.get('/api/auth/session')).json();
    const email = `salary-api-${unique}-${index}@example.invalid`;
    accounts.push(email);
    assert.equal((await client.post('/api/auth/register', { data: { name: 'Salary API Test', email, password: 'Test-only-password-2026' }, headers: { 'X-CSRF-Token': session.csrf } })).status(), 201);
  }
  const clients = await Promise.all(contexts.map(async client => {
    const session = await (await client.get('/api/auth/session')).json();
    const cookie = (await client.storageState()).cookies.map(value => `${value.name}=${value.value}`).join('; ');
    return { client, session, cookie };
  }));
  const localRequest = (path, input, csrf = clients[0].session.csrf, method = 'POST') => handleApi(new Request(baseURL + '/api/' + path, { method, headers: { Cookie: clients[0].cookie, Origin: new URL(baseURL).origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(method === 'POST' ? { body: JSON.stringify(input) } : {}) }));
  const add = async (client, number, salary = '') => {
    const response = await client.client.post('/api/workspace/items', { data: { kind: 'application', payload: { title: 'Salary API application', company: 'Fixture employer', url: source(number), salary, notes: 'Preserved personal note', status: 'Saved', date: '2026-10-14' } }, headers: { 'X-CSRF-Token': client.session.csrf } });
    assert.equal(response.status(), 200);
    return (await response.json()).item;
  };
  const blank = await add(clients[0], 1), manual = await add(clients[0], 2, 'PHP 77,000/month'), race = await add(clients[0], 3), blocked = await add(clients[0], 4), foreign = await add(clients[1], 5);
  const liveRefresh = await clients[0].client.post('/api/workspace/salaries', { data: { ids: [manual.id] }, headers: { 'X-CSRF-Token': clients[0].session.csrf } });
  assert.equal(liveRefresh.status(), 200, 'The running preview exposes the workspace salary endpoint');
  assert.deepEqual((await liveRefresh.json()).updated, []);
  const liveLookup = await clients[0].client.post('/api/jobs/salary', { data: { urls: ['https://example.com/jobs/1'] }, headers: { 'X-CSRF-Token': clients[0].session.csrf } });
  assert.equal(liveLookup.status(), 200, 'The running preview exposes the salary lookup endpoint');
  assert.equal((await liveLookup.json()).results[0].state, 'unsupported');
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!url.startsWith('https://www.onlinejobs.ph/jobseekers/job/salary-api-')) return realFetch(input, init);
    fetches.push(url);
    if (url === source(3)) { sourceReached(); await sourceGate; }
    if (url === source(4)) return new Response('Source blocked', { status: 403 });
    return new Response('<h2>WAGE/SALARY</h2><p>PHP 35,000 – PHP 45,000 per month</p>', { headers: { 'Content-Type': 'text/html' } });
  };
  assert.equal((await localRequest('workspace/salaries', { ids: [blank.id] }, 'invalid')).status, 403);
  assert.equal((await localRequest('workspace/salaries', { ids: [blank.id, foreign.id] })).status, 404);
  assert.deepEqual(fetches, [], 'CSRF and owner checks happen before source fetching or writes');
  const response = await localRequest('workspace/salaries', { ids: [blank.id, manual.id, blocked.id] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).updated, [{ id: blank.id, salary: 'PHP 35,000–45,000/month' }]);
  const read = async id => (await (await clients[0].client.get('/api/workspace/items')).json()).items.find(item => item.id === id);
  assert.deepEqual((await read(blank.id)).payload, { ...blank.payload, salary: 'PHP 35,000–45,000/month' }, 'Only salary changes and survives a fresh backend read');
  assert.deepEqual((await read(manual.id)).payload, manual.payload, 'Manual salary remains unchanged');
  assert.deepEqual((await read(blocked.id)).payload, blocked.payload, 'A blocked source does not alter the application');
  assert.equal(fetches.includes(source(2)), false, 'Manual salaries do not trigger source fetching');
  const inFlight = localRequest('workspace/salaries', { ids: [race.id] });
  await sourceStarted;
  const edited = { ...race.payload, salary: 'PHP 100,000/month (manual)', notes: 'Edited during salary fetch', status: 'Offer' };
  assert.equal((await clients[0].client.post('/api/workspace/items', { data: { kind: 'application', id: race.id, payload: edited }, headers: { 'X-CSRF-Token': clients[0].session.csrf } })).status(), 200);
  release();
  assert.deepEqual((await (await inFlight).json()).updated, [], 'Concurrent manual edits win atomically');
  assert.deepEqual((await read(race.id)).payload, edited);
  const lookup = await localRequest('jobs/salary', { urls: [source(1), 'https://example.com/jobs/1'] });
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).results[0].salary, 'PHP 35,000–45,000/month');
  assert.equal((await localRequest('workspace/salaries', null, clients[0].session.csrf, 'GET')).status, 405);
  console.log('PASS: real backend salary persistence, preserving status/notes/manual salaries, blocked sources, authenticated salary lookup, CSRF, account isolation and atomic concurrent-edit protection.');
} finally {
  release?.();
  globalThis.fetch = realFetch;
  for (const email of accounts) {
    const user = await query(db().from('users').select('id').eq('email', email).maybeSingle());
    if (user) { await query(db().from('workspace_items').delete().eq('user_id', user.id)); await query(db().from('joblink_sessions').delete().eq('user_id', user.id)); await query(db().from('users').delete().eq('id', user.id)); }
  }
  await Promise.all(contexts.map(client => client.dispose()));
}
