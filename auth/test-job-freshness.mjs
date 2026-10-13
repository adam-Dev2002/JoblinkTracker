import assert from 'node:assert/strict';
import { createJobFreshness, newJobWindow } from '../jobfinder/preview/scripts/job-freshness.ts';

let time = Date.parse('2026-10-13T10:00:00Z'), writes = 0;
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes++; values.set(key, value); } };
const create = owner => createJobFreshness(owner, { storage, now: () => time });
const listing = (id, date = '') => ({ id, source: 'Fixture feed', url: `https://example.com/jobs/${id}`, date });
let history = create(1);
const known = listing('known'), added = listing('added');
history.observe([known]);
assert.match(history.label(known), /Newly discovered/, 'Undated jobs are New from their first detection, including the initial search');
time += 60 * 60 * 1000;
history.observe([known, added]);
assert.match(history.label(known), /Newly discovered/);
assert.match(history.label(added), /Newly discovered/);
const detected = time, writesBeforeRender = writes;
for (let index = 0; index < 100; index++) history.label(added);
assert.equal(writes, writesBeforeRender, 'Rendering never serializes discovery history');
history = create(1);
time += 24 * 60 * 60 * 1000;
assert.match(history.label(added), /Newly discovered/, 'Reloading retains the original detection time');
history.observe([added]);
assert.equal(writes, writesBeforeRender, 'Repeated results do not renew the detection timestamp');
time = detected + newJobWindow;
assert.equal(history.label(added), null, 'New expires at the 48-hour boundary');
history.observe([added]);
assert.equal(history.label(added), null, 'Revisiting cannot make an old result New again');

const recent = listing('recent', new Date(time - 60 * 60 * 1000).toISOString());
const old = listing('old', new Date(time - newJobWindow - 1).toISOString());
const future = listing('future', new Date(time + 1000).toISOString());
history.observe([recent, old, future]);
assert.match(history.label(recent), /Posted/);
assert.equal(history.label(old), null);
assert.equal(history.label(future), null);
history.observe([listing('old-arrival', old.date)]);
assert.equal(history.label(listing('old-arrival', old.date)), null, 'Discovering an old dated posting does not claim it was recently posted');
assert.match(history.label({ ...recent, id: 'google-copy', source: 'Google', date: '' }), /Posted/, 'A Google copy can reuse a known publication date');
assert.equal(history.label(listing('date-only-old', '2000-01-01')), null);
assert.match(history.label(listing('utc-date', new Date(time).toISOString().slice(0, 19).replace('T', ' '))), /Posted/, 'Offset-free provider dates consistently use UTC');

const firstDifferentSearch = listing('different-search');
history.observe([firstDifferentSearch]);
assert.match(history.label(firstDifferentSearch), /Newly discovered/, 'A first result in a different search or filter receives New immediately');
const cached = listing('cached'), live = listing('live');
history.observe([cached]);
assert.match(history.label(cached), /Newly discovered/);
history.observe([cached, live]);
assert.match(history.label(live), /Newly discovered/);
const cachedArrival = listing('cached-arrival');
history.observe([cachedArrival]);
assert.match(history.label(cachedArrival), /Newly discovered/, 'Previously unobserved preview results share the same detection rules');

const canonical = { id: 'board-known', source: 'Google', url: 'https://www.onlinejobs.ph/jobseekers/job/assistant-123', date: '' };
history.observe([canonical]);
history.observe([{ ...canonical, id: 'redirect-copy', source: 'Other source', url: 'https://www.google.com/url?q=' + encodeURIComponent(canonical.url + '?utm_source=google#apply') }]);
assert.match(history.label(canonical), /Newly discovered/);
history.observe([{ ...known, url: 'https://example.com/replaced-url' }]);
assert.equal(history.label({ ...known, url: 'https://example.com/replaced-url' }), null, 'Stable source IDs preserve an expired detection after URL changes');
assert.equal(create(2).label(live), null, 'Discovery history never leaks between accounts');

const legacy = listing('legacy'), legacyExpired = { ...listing('legacy-expired'), url: 'https://example.com/jobs/legacy-expired?b=2&a=1' };
const legacyValues = new Map([['joblink-job-discovery-v1:5', JSON.stringify({ owner: 5, channels: ['google:old-filter'], entries: [
  ['url:' + legacy.url, { detectedAt: time - 24 * 60 * 60 * 1000 }],
  ['url:' + legacyExpired.url, { detectedAt: time - newJobWindow - 1 }],
] })]]);
const legacyHistory = createJobFreshness(5, { storage: { getItem: key => legacyValues.get(key) ?? null, setItem: (key, value) => legacyValues.set(key, value) }, now: () => time });
assert.match(legacyHistory.label(legacy), /Newly discovered/, 'Previously suppressed baseline jobs gain New without losing their first detection time');
assert.equal(legacyHistory.label(legacyExpired), null, 'The update never renews expired legacy detections');
legacyHistory.observe([legacy, legacyExpired]);
assert.equal(JSON.parse(legacyValues.get('joblink-job-discovery-v1:5')).entries.find(([key]) => key === 'url:' + legacy.url)[1].detectedAt, time - 24 * 60 * 60 * 1000);
const reorderedLegacy = { ...legacyExpired, id: 'copy-in-another-source', source: 'Other source', url: 'https://example.com/jobs/legacy-expired?a=1&b=2' };
legacyHistory.observe([reorderedLegacy]);
assert.equal(legacyHistory.label(reorderedLegacy), null, 'Migrated URL identities retain expired timestamps across parameter order and source changes');

const saturated = new Map([['joblink-job-discovery-v1:6', JSON.stringify({ owner: 6, entries: Array.from({ length: 5000 }, (_, index) => ['url:https://example.com/previous/' + index, { detectedAt: time - newJobWindow - 1 }]) })]]);
const saturatedStorage = { getItem: key => saturated.get(key) ?? null, setItem: (key, value) => saturated.set(key, value) };
const fullHistory = createJobFreshness(6, { storage: saturatedStorage, now: () => time });
fullHistory.observe([added]);
assert.match(fullHistory.label(added), /Newly discovered/, 'A full persistent history must not suppress newly detected jobs');
assert.match(createJobFreshness(6, { storage: saturatedStorage, now: () => time }).label(added), /Newly discovered/, 'New detections remain saved when history reaches its cap');

const corruptStorage = { getItem: () => '{broken', setItem() {} };
const corrupt = createJobFreshness(1, { storage: corruptStorage, now: () => time });
corrupt.observe([known]);
assert.match(corrupt.label(known), /Newly discovered/);
const blocked = createJobFreshness(1, { storage: { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } }, now: () => time });
blocked.observe([known]);
blocked.observe([known, live]);
assert.match(blocked.label(live), /Newly discovered/, 'Unavailable storage still permits in-page discovery');
console.log('PASS: recent publication dates, first detection across searches and filters, 48-hour expiry, persistent timestamps, preview/search/source deduplication, account isolation, optional storage and zero render writes.');
