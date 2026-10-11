import assert from "node:assert/strict";
import { matchesJobQuery } from "../jobfinder/preview/server/job-search.mjs";

assert.equal(
  matchesJobQuery("acme developer", ["Senior Developer", "Acme Tools"]),
  true,
);
assert.equal(
  matchesJobQuery("developer acme", ["Senior Developer", "Acme Tools"]),
  true,
);
assert.equal(
  matchesJobQuery("designer acme", ["Senior Developer", "Acme Tools"]),
  false,
);
assert.equal(
  matchesJobQuery("bookkeeper, developer", ["Senior Developer"]),
  true,
);
assert.equal(matchesJobQuery("cafe", ["Café Team"]), true);
assert.equal(matchesJobQuery(" , ", ["Any listing"]), true);

// Exercise the actual feed adapters with provider fixtures, without credentials
// or outside network traffic.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const row = {
    title: "Senior Developer",
    company_name: "Acme Tools",
    description: "<p>TypeScript and remote collaboration.</p>",
    url: "https://example.com/job/1",
  };
  const payload = String(url).includes("remotive.com")
    ? {
        jobs: [
          {
            ...row,
            id: 1,
            category: "Software",
            candidate_required_location: "Worldwide",
          },
        ],
      }
    : String(url).includes("jobicy.com")
      ? {
          jobs: [
            {
              id: 1,
              jobTitle: row.title,
              companyName: row.company_name,
              jobDescription: row.description,
              jobIndustry: ["Software"],
              url: row.url,
            },
          ],
        }
      : {
          data: [
            {
              ...row,
              slug: "developer",
              tags: ["Software"],
              location: "Worldwide",
            },
          ],
        };
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
};
try {
  const { jobs } = await import("../jobfinder/preview/server/jobs.mjs");
  for (const source of ["remotive", "jobicy", "arbeitnow"]) {
    for (const [keyword, count] of [
      ["acme developer", 1],
      ["typescript", 1],
      ["bookkeeper, developer", 1],
      ["designer acme", 0],
    ]) {
      const url = new URL(
        "https://joblink.test/api/jobs/search?" +
          new URLSearchParams({ source, q: keyword }),
      );
      const response = await jobs(new Request(url), url);
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).jobs.length,
        count,
        `${source}: ${keyword}`,
      );
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "PASS: role/company/skill search, word order, comma alternatives and accents across all three working feed adapters.",
);
