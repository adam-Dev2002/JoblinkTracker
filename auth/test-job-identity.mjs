import assert from 'node:assert/strict';
import { jobListingIdentity, jobSourceIdentity } from '../jobfinder/preview/scripts/job-identity.ts';

const pairs = [
  ['https://www.onlinejobs.ph/jobseekers/job/Automation-specialist-1748721', 'http://onlinejobs.ph/jobseekers/job/Updated-job-title-1748721/?utm_source=search&ref=google#apply'],
  ['https://www.onlinejobs.ph/jobseekers/job/1748721', 'https://www.google.com/url?q=' + encodeURIComponent('https://onlinejobs.ph/jobseekers/job/Updated-job-title-1748721?utm_campaign=jobs')],
  ['https://www.linkedin.com/jobs/view/engineer-at-company-4412345678', 'https://ph.linkedin.com/jobs/view/4412345678/?trackingId=next-search'],
  ['https://ph.jobstreet.com/job/88123456?type=standard', 'https://www.jobstreet.com.ph/job/88123456/?ref=search'],
  ['https://ph.indeed.com/viewjob?jk=abc123&from=google&vjs=3', 'https://www.indeed.com/viewjob?from=feed&jk=abc123'],
  ['https://ph.indeed.com/viewjob?jk=abc123', 'https://uk.indeed.com/rc/clk?jk=abc123&from=search'],
  ['https://boards.greenhouse.io/company/jobs/5551234?gh_src=feed', 'https://job-boards.greenhouse.io/company/jobs/5551234/?gh_src=google'],
  ['https://jobs.lever.co/company/abc-123?lever-source=google', 'https://jobs.lever.co/company/abc-123/apply?lever-origin=feed'],
  ['https://jobs.ashbyhq.com/company/abc-123', 'https://jobs.ashbyhq.com/company/abc-123/application?utm_source=google'],
  ['https://remotive.com/remote-jobs/software-dev/original-title-123456', 'https://remotive.io/remote-jobs/marketing/edited-title-123456?utm_source=feed'],
  ['https://jobicy.com/jobs/123456-original-title', 'https://jobicy.com/jobs/123456-edited-title/?utm_source=google'],
  ['http://www.example.com/jobs/123/?posting=4&language=en&utm_source=feed#apply', 'https://example.com/jobs/123?utm_medium=search&language=en&posting=4'],
];
for (const [original, returning] of pairs) {
  assert.ok(jobListingIdentity(original), original);
  assert.equal(jobListingIdentity(returning), jobListingIdentity(original), `Same posting: ${returning}`);
}
const distinct = [
  ['https://onlinejobs.ph/jobseekers/job/assistant-123', 'https://onlinejobs.ph/jobseekers/job/assistant-124'],
  ['https://linkedin.com/jobs/view/123', 'https://onlinejobs.ph/jobseekers/job/123'],
  ['https://ph.indeed.com/viewjob?jk=abc123', 'https://ph.indeed.com/viewjob?jk=abc124'],
  ['https://boards.greenhouse.io/first/jobs/123', 'https://boards.greenhouse.io/second/jobs/123'],
  ['https://jobs.lever.co/first/123', 'https://jobs.lever.co/second/123'],
  ['https://jobs.lever.co/company/123', 'https://jobs.ashbyhq.com/company/123'],
  ['https://example.com/jobs?posting=123&utm_source=feed', 'https://example.com/jobs?posting=124&utm_source=feed'],
  ['https://example.com/jobs?ref=123', 'https://example.com/jobs?ref=124'],
  ['https://example.com/careers#/jobs/123', 'https://example.com/careers#/jobs/124'],
  ['https://example.com/jobs/123', 'https://other.example/jobs/123'],
  ['https://onlinejobs.ph/jobseekers/job/123', 'https://onlinejobs.ph:8443/jobseekers/job/123'],
  ['https://onlinejobs.ph/jobseekers/job/123', 'https://onlinejobs.ph.evil.example/jobseekers/job/123'],
];
for (const [first, second] of distinct) assert.notEqual(jobListingIdentity(first), jobListingIdentity(second), `Distinct postings: ${first} and ${second}`);
for (const value of ['', undefined, null, 123, 'javascript:alert(1)', '/static/company-logos/example.svg', 'https://someone@onlinejobs.ph/jobseekers/job/123', 'ftp://www.google.com/url?q=https://onlinejobs.ph/jobseekers/job/123']) {
  assert.equal(jobListingIdentity(value), '', 'Invalid URLs never create a shared empty identity');
}
assert.equal(jobSourceIdentity(' Remotive ', '123'), jobSourceIdentity('remotive', '123'));
assert.notEqual(jobSourceIdentity('First feed', '123'), jobSourceIdentity('Second feed', '123'));
for (const [source, id] of [['', '123'], ['Feed', ''], [undefined, '123'], ['Feed', 123]]) assert.equal(jobSourceIdentity(source, id), '');
console.log('PASS: stable posting IDs across provider aliases, edited slugs, redirects and tracking; generic URL normalization; distinct new postings, employers and identifying query parameters; invalid identities.');
