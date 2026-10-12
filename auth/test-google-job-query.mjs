import assert from "node:assert/strict";
import {
  googleJobQuery,
  isGoogleJobListing,
  googleJobListingUrl,
} from "../jobfinder/preview/scripts/google-job-query.ts";

const query = googleJobQuery({
  keyword: "assistant, bookkeeper",
  classification: "Finance & operations",
  location: "Manila",
  employment: "Part-time",
  listingTime: "7",
});
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
