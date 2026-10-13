import assert from 'node:assert/strict';
import { makeApplicationIndex } from '../jobfinder/preview/scripts/application-index.ts';
import { jobListingIdentity, jobSourceIdentity } from '../jobfinder/preview/scripts/job-identity.ts';

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
const returningJob = { ...job, id: 'new-search-id', source: 'Google · onlinejobs.ph', url: 'https://onlinejobs.ph/jobseekers/job/new-title-123/?utm_source=google&ref=search#apply' };
assert.equal(makeApplicationIndex([urlMatch]).lookup(returningJob), urlMatch, 'Applied jobs match the same posting ID after search URLs, title slugs, tracking and source IDs change');
assert.equal(makeApplicationIndex([unavailable]).isUnavailable(returningJob), true, 'Unavailable jobs stay hidden when search returns another link to the same posting');
assert.equal(makeApplicationIndex([saved, unavailable]).isHidden(returningJob), true, 'A saved duplicate cannot override an unavailable posting');
assert.equal(makeApplicationIndex([{ ...unavailable, payload: { ...unavailable.payload, status: 'Saved' } }]).isUnavailable(job), false, 'Changing back to Saved restores availability');
for (const status of ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted']) {
  const application = record(9, { url: listing, status });
  assert.equal(makeApplicationIndex([saved, application]).lookup(job), application, `${status} remains applied`);
  assert.equal(makeApplicationIndex([saved, application]).isHidden(returningJob), true, `${status} stays hidden under changed search links`);
}
for (const status of ['Saved', 'Application opened']) assert.equal(makeApplicationIndex([record(90, { url: listing, status })]).isHidden(returningJob), false, `${status} remains eligible for discovery`);
assert.equal(makeApplicationIndex([record(91, { url: '', source: '', jobId: '', status: 'Unavailable' })]).isHidden({ id: '', source: '', url: 'javascript:alert(1)' }), false, 'Missing identities cannot hide unrelated jobs');
assert.equal(makeApplicationIndex([unavailable]).isHidden({ ...returningJob, url: returningJob.url.replace('-123/', '-124/') }), false, 'A new posting ID is not hidden by the same title or employer');

// Compare the index with a scan using canonical identities, including duplicate
// URLs and source IDs, unsafe inputs, and conflicting application records.
const identity = jobListingIdentity;
const statuses = ['Saved', 'Application opened', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Unavailable'];
const urls = [listing, 'http://www.onlinejobs.ph/jobseekers/job/developer-123#apply', 'https://www.google.com/url?q=' + encodeURIComponent(listing), 'https://example.com/job/1', 'https://example.com/job/2', '', 'javascript:alert(1)', '/static/company-logos/example.svg'];
const applications = Array.from({ length: 1400 }, (_, id) => record(id, { url: urls[id % urls.length], source: ['Feed A', 'Feed B', 'Feed C'][id % 3], jobId: String(id % 17), status: statuses[id % statuses.length] }));
const index = makeApplicationIndex(applications);
for (const url of urls) for (const source of ['Feed A', 'Feed B', 'Feed C', 'Other']) for (const id of ['0', '1', '16', 'missing']) {
  const candidate = { url, source, id };
  const urlIdentity = identity(url);
  const sourceIdentity = jobSourceIdentity(source, id);
  const matches = applications.filter(item => (urlIdentity && identity(item.payload.url) === urlIdentity) || (sourceIdentity && jobSourceIdentity(item.payload.source, item.payload.jobId) === sourceIdentity));
  const expected = matches.find(item => ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'].includes(item.payload.status)) || matches[0];
  assert.equal(index.lookup(candidate), expected, `Scan parity for ${JSON.stringify(candidate)}`);
  assert.equal(index.isHidden(candidate), matches.some(item => statuses.slice(2).includes(item.payload.status)), `Hidden status scan parity for ${JSON.stringify(candidate)}`);
}

// Only the job URL is normalized on lookup; recorded URLs are processed once.
let payloadReads = 0;
const counted = applications.map(item => ({ id: item.id, get payload() { payloadReads++; return item.payload; } }));
const countedIndex = makeApplicationIndex(counted);
payloadReads = 0;
for (let attempt = 0; attempt < 1000; attempt++) { countedIndex.lookup(job); countedIndex.isUnavailable(job); countedIndex.isHidden(job); }
assert.equal(payloadReads, 0, 'Repeated card lookups never rescan application payloads');
console.log('PASS: stable posting identity across searches, applied/unavailable exclusion, duplicate status priority, restoration, scan parity, invalid identities and constant-time record access.');
