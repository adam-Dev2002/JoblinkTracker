import assert from 'node:assert/strict';
import { makeApplicationIndex } from '../jobfinder/preview/scripts/application-index.ts';
import { googleJobListingUrl } from '../jobfinder/preview/scripts/google-job-query.ts';

const listing = 'https://www.onlinejobs.ph/jobseekers/job/developer-123';
const job = { id: '123', source: 'OnlineJobs.ph', url: listing };
const record = (id, payload) => ({ id, payload });
const saved = record(1, { url: listing, status: 'Saved' });
const identityMatch = record(2, { jobId: job.id, source: job.source, url: 'https://example.com/source', status: 'Interview' });
const urlMatch = record(3, { url: 'http://www.onlinejobs.ph/jobseekers/job/developer-123#apply', status: 'Applied' });
assert.equal(makeApplicationIndex([]).lookup(job), undefined);
assert.equal(makeApplicationIndex([saved, urlMatch]).lookup(job), urlMatch, 'Applied URL matches take priority over earlier saved records');
assert.equal(makeApplicationIndex([saved, identityMatch, urlMatch]).lookup(job), identityMatch, 'The first applied record across both identities wins');
assert.equal(makeApplicationIndex([saved, urlMatch, identityMatch]).lookup(job), urlMatch, 'Original application order breaks applied ties');
assert.equal(makeApplicationIndex([saved, record(4, { jobId: job.id, source: job.source, status: 'Application opened' })]).lookup(job), saved, 'The first saved/opened record wins if none is applied');
assert.equal(makeApplicationIndex([urlMatch]).lookup({ ...job, url: 'https://www.google.com/url?q=' + encodeURIComponent(listing) }), urlMatch, 'Google redirect and HTTP/fragment variants share their canonical listing');
assert.equal(makeApplicationIndex([identityMatch]).lookup({ ...job, url: '' }), identityMatch, 'An empty job URL still supports source and job ID matches');
assert.equal(makeApplicationIndex([identityMatch]).lookup({ ...job, source: 'Other source', url: '' }), undefined, 'Source IDs remain separate');
assert.equal(makeApplicationIndex([saved]).lookup({ ...job, url: '', id: 'missing' }), undefined, 'An empty job URL does not trigger URL matching');
const unavailable = record(10, { url: listing, jobId: job.id, source: job.source, status: 'Unavailable' });
assert.equal(makeApplicationIndex([saved, unavailable]).isUnavailable(job), true, 'Unavailable matches are found even behind a saved duplicate');
assert.equal(makeApplicationIndex([unavailable]).isUnavailable({ ...job, url: 'https://example.com/new-url' }), true, 'Source and ID still match after a URL change');
assert.equal(makeApplicationIndex([unavailable]).isUnavailable({ ...job, source: 'Other source', url: '' }), false, 'Unavailable state stays scoped to the listing identity');
assert.equal(makeApplicationIndex([unavailable]).isUnavailable({ ...job, url: 'https://www.google.com/url?q=' + encodeURIComponent(listing) }), true);
assert.equal(makeApplicationIndex([{ ...unavailable, payload: { ...unavailable.payload, status: 'Saved' } }]).isUnavailable(job), false, 'Changing back to Saved restores availability');
for (const status of ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted']) {
  const application = record(9, { url: listing, status });
  assert.equal(makeApplicationIndex([saved, application]).lookup(job), application, `${status} remains applied`);
}

// Compare the index with the previous scan, including duplicate URLs, duplicate
// source IDs, unsafe inputs, arbitrary feed URLs, and conflicting identities.
const safeUrl = value => {
  if (value?.startsWith('/static/company-logos/') && !value.includes('..')) return value;
  try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
const identity = value => googleJobListingUrl(value || '') || safeUrl(value);
const statuses = ['Saved', 'Application opened', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'];
const urls = [listing, 'http://www.onlinejobs.ph/jobseekers/job/developer-123#apply', 'https://www.google.com/url?q=' + encodeURIComponent(listing), 'https://example.com/job/1', 'https://example.com/job/2', '', 'javascript:alert(1)', '/static/company-logos/example.svg'];
const applications = Array.from({ length: 1400 }, (_, id) => record(id, { url: urls[id % urls.length], source: ['Feed A', 'Feed B', 'Feed C'][id % 3], jobId: String(id % 17), status: statuses[id % statuses.length] }));
const index = makeApplicationIndex(applications);
for (const url of urls) for (const source of ['Feed A', 'Feed B', 'Feed C', 'Other']) for (const id of ['0', '1', '16', 'missing']) {
  const candidate = { url, source, id };
  const matches = applications.filter(item => (url && identity(item.payload.url) === identity(url)) || (item.payload.jobId === id && item.payload.source === source));
  const expected = matches.find(item => statuses.slice(2).includes(item.payload.status)) || matches[0];
  assert.equal(index.lookup(candidate), expected, `Scan parity for ${JSON.stringify(candidate)}`);
}

// Only the job URL is normalized on lookup; recorded URLs are processed once.
let payloadReads = 0;
const counted = applications.map(item => ({ id: item.id, get payload() { payloadReads++; return item.payload; } }));
const countedIndex = makeApplicationIndex(counted);
payloadReads = 0;
for (let attempt = 0; attempt < 1000; attempt++) { countedIndex.lookup(job); countedIndex.isUnavailable(job); }
assert.equal(payloadReads, 0, 'Repeated card lookups never rescan application payloads');
console.log('PASS: indexed application lookup preserves URL/source identity, first applied priority, scan parity, and constant-time repeated record access.');
