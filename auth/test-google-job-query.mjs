import assert from "node:assert/strict";
import {
  googleJobQuery,
  isGoogleJobListing,
  googleJobListingUrl,
  matchesGoogleJobSearch,
} from "../jobfinder/preview/scripts/google-job-query.ts";

const query = googleJobQuery({
  keyword: "assistant, bookkeeper",
  classification: "Finance & operations",
  location: "Manila",
  employment: "Part-time",
  listingTime: "7",
});
const filters = { keyword: 'AI developer', location: '' };
assert.equal(matchesGoogleJobSearch(filters, 'AI-First Developer', 'Build software.'), true);
assert.equal(matchesGoogleJobSearch(filters, 'Chair Developer', 'Build software.'), false, 'Short keywords must match whole words');
assert.equal(matchesGoogleJobSearch(filters, 'AI Specialist', 'Development team.'), false, 'Every keyword must appear');
assert.equal(matchesGoogleJobSearch({ keyword: 'bookkeeper, AI developer', location: '' }, 'Bookkeeper', ''), true);
assert.equal(matchesGoogleJobSearch({ keyword: 'cafe developer', location: 'Manila' }, 'Café Developer', 'Remote role in Manila.'), true);
assert.equal(matchesGoogleJobSearch({ ...filters, location: 'web developer' }, 'AI Web Developer', 'Full-time role in Manila.'), false, 'A role in the title does not prove a matching location');
assert.equal(matchesGoogleJobSearch({ ...filters, location: 'Manila' }, 'AI Developer', 'Work in Cebu.'), false);
assert.ok(query.includes("(assistant OR bookkeeper)"));
assert.ok(query.includes("accountant"));
assert.ok(query.includes("Manila"));
assert.ok(query.includes('"Part-time"'));
assert.ok(query.includes("after:"));
assert.ok(query.includes("site:onlinejobs.ph/jobseekers/job/"));
const broadQuery = googleJobQuery({
  keyword: "",
  classification: "",
  location: "",
  employment: "",
  listingTime: "",
});
assert.ok(broadQuery.startsWith("(site:"));
assert.ok(!query.includes(" jobs "));
for (const url of [
  "https://www.onlinejobs.ph/jobseekers/job/assistant-123",
  "https://www.linkedin.com/jobs/view/software-engineer-123",
  "https://ph.jobstreet.com/job/123456",
  "https://ph.indeed.com/viewjob?jk=1234",
  "https://jobs.lever.co/company/1234",
  "https://job-boards.greenhouse.io/company/jobs/1234",
  "https://jobs.ashbyhq.com/company/1234",
])
  assert.equal(isGoogleJobListing(url), true, url);
for (const url of [
  "javascript:alert(1)",
  "https://www.onlinejobs.ph/blog/job-search-advice",
  "https://ph.indeed.com/jobs?q=assistant",
  "https://www.linkedin.com/jobs/search/",
  "https://jobs.lever.co/company",
  "https://www.linkedin.com.evil.example/jobs/view/123",
  "https://someone@www.linkedin.com/jobs/view/123",
  "https://example.com/jobs/123",
])
  assert.equal(isGoogleJobListing(url), false, url);
console.log(
  "PASS: Google category/location/type/date queries, comma alternatives, supported job-detail URLs and rejection of articles, search pages, unsafe protocols and lookalike domains.",
);
const originalListing =
  "https://www.onlinejobs.ph/jobseekers/job/assistant-123";
assert.equal(googleJobListingUrl('http://www.onlinejobs.ph/jobseekers/job/assistant-123#apply'), originalListing, 'Old HTTP indexed URLs use the supported HTTPS listing');
assert.equal(googleJobListingUrl('https://www.onlinejobs.ph:8443/jobseekers/job/assistant-123'), '', 'Unsupported ports are rejected before displaying listings');
assert.equal(
  googleJobListingUrl(
    "https://www.google.com/url?client=internal-element-cse&q=" +
      encodeURIComponent(originalListing),
  ),
  originalListing,
);
assert.equal(
  googleJobListingUrl("https://www.google.com/url?q=javascript%3Aalert(1)"),
  "",
);
assert.equal(
  googleJobListingUrl(
    "https://evil.example/url?q=" + encodeURIComponent(originalListing),
  ),
  "",
);
