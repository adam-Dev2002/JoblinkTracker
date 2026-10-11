import assert from "node:assert/strict";
import { createFeedCache } from "../jobfinder/preview/server/feed-cache.mjs";

let time = Date.now(),
  reads = 0,
  writes = 0,
  fetches = 0;
const store = new Map();
const dependencies = {
  now: () => time,
  read: async (key) => {
    reads++;
    return store.get(key);
  },
  write: async (key, payload, expires_at) => {
    writes++;
    store.set(key, { payload, expires_at });
  },
  fetcher: async (_url, options) => {
    fetches++;
    assert.ok(options.signal);
    return new Response(
      JSON.stringify({
        jobs: [
          { title: "Developer", description: "Repeated content ".repeat(1000) },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
const cached = createFeedCache(dependencies);
const [first, simultaneous] = await Promise.all([
  cached("test", "https://example.com/feed", {}, 10),
  cached("test", "https://example.com/feed", {}, 10),
]);
assert.deepEqual(first, simultaneous);
assert.equal(reads, 1);
assert.equal(fetches, 1);
await cached("test", "https://example.com/feed", {}, 10);
assert.equal(reads, 1);
assert.equal(fetches, 1);
const stored = store.get("feed-v2:test");
assert.equal(stored.payload.encoding, "gzip-base64-v1");
assert.ok(stored.payload.data.length < JSON.stringify(first).length / 4);
const afterRestart = createFeedCache(dependencies);
assert.deepEqual(
  await afterRestart("test", "https://example.com/feed", {}, 10),
  first,
);
assert.equal(reads, 2);
assert.equal(fetches, 1);
time += 11000;
await afterRestart("test", "https://example.com/feed", {}, 10);
assert.equal(fetches, 2);
assert.equal(writes, 2);
const noDatabase = createFeedCache({
  ...dependencies,
  read: async () => {
    throw Error("Database unavailable");
  },
  write: async () => {
    throw Error("Database unavailable");
  },
});
assert.deepEqual(await noDatabase("test", "https://example.com/feed"), first);
let reject = true;
const retry = createFeedCache({
  ...dependencies,
  read: async () => null,
  fetcher: async () => {
    if (reject) {
      reject = false;
      return new Response("", { status: 503 });
    }
    return new Response('{"jobs":[]}');
  },
});
await assert.rejects(retry("test", "https://example.com/feed"), /unavailable/);
assert.deepEqual(await retry("test", "https://example.com/feed"), { jobs: [] });
console.log(
  "PASS: memory hits, coalesced concurrent reads, compressed persistent cache across restart, TTL expiry, database outage fallback and failed-provider retry.",
);
