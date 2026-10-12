import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { loadEnv } from "../jobfinder/node_modules/vite/dist/node/index.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mockOpenAvailability } from './job-availability-fixture.mjs';

for (const [key, value] of Object.entries(
  loadEnv(
    "development",
    fileURLToPath(new URL("../jobfinder/preview/", import.meta.url)),
    "",
  ),
))
  process.env[key] ??= value;
const email = `auth-test-bulk-${Date.now()}@example.invalid`;
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({ baseURL: process.env.JOBLINK_BASE_URL || "http://127.0.0.1:3000" });
const page = await context.newPage();
await mockOpenAvailability(context);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const jobs = Array.from({ length: 218 }, (_, index) => ({
  id: `bulk-${index}`,
  title: `Software Developer ${index}`,
  company: `Company ${index}`,
  location: index % 2 ? "USA" : "Manila, Philippines",
  employmentType: index % 2 ? "Contract" : "Full-time",
  role: "Development & IT",
  url: `https://example.com/jobs/${index}`,
  source: "Test feed",
  salary: "",
  date: "2026-10-12",
  logo: "",
  workMode: "Remote / WFH",
  description: "Job description",
  direct: false,
}));
const listingNow = new Date("2026-10-12T12:00:00Z");
const listingDates = [0, 1, 1 + 1 / 86400000, 3, 7, 14, 30, 31].map((days) =>
  new Date(listingNow.getTime() - days * 86400000).toISOString(),
);
listingDates.push("", "invalid-date", "2026-10-13T12:00:00Z");
listingDates[3] = "2026-10-09 12:00:00";
listingDates[4] = "2026-10-05T20:00:00+08:00";
listingDates.forEach((date, index) => {
  jobs[index].date = date;
});
const items = [
  {
    id: 1,
    kind: "application",
    payload: { ...jobs[0], url: 'https://example.com/jobs/already-applied', jobId: 'already-applied', status: "Applied" },
  },
];
const writes = [];
let rejectOnce = true;
let delaySave;
let source = "all";
let searchRequests = 0;
async function selectBatch() {
  const bulk = page.locator('[data-job-select-all]');
  if (await bulk.isChecked()) await bulk.uncheck();
  await bulk.check();
}
try {
  const session = await (await context.request.get("/api/auth/session")).json();
  const response = await context.request.post("/api/auth/register", {
    data: { name: "Bulk Test", email, password: "Test-only-password-2026" },
    headers: { "X-CSRF-Token": session.csrf },
  });
  assert.equal(response.status(), 201);
  await context.route("https://www.google.com/s2/favicons?*", (route) =>
    route.abort(),
  );
  await context.route("https://jobs.lever.co/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Source website</h1>",
    }),
  );
  await context.route("https://cse.google.com/cse.js?cx=*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.googleFixtureQueries = [];
    const fixtureResults = [
      {title:'<b>Google Software Developer</b>',url:'https://jobs.lever.co/example/abc123',content:'TypeScript developer role.'},
      {title:'Google Virtual Assistant',url:'https://www.google.com/url?client=internal-element-cse&q=https%3A%2F%2Fwww.onlinejobs.ph%2Fjobseekers%2Fjob%2Fassistant-123',content:'<img src=x onerror="window.googleInjection=true">Remote assistant.'},
      {title:'Advice article',url:'https://www.onlinejobs.ph/blog/job-search-advice',content:'Not a listing.'},
      {title:'Unsafe',url:'javascript:alert(1)',content:'Unsafe link.'}
    ];
    let resultDiv;
    const result = (query, second = false) => {
      window.__gcse.searchCallbacks.web.starting('joblink-google-jobs',query);
      window.__gcse.searchCallbacks.web.ready('joblink-google-jobs',query,[],second ? [{title:'Another Developer',url:'https://jobs.ashbyhq.com/example/def456',content:'Second page.'}] : fixtureResults,resultDiv);
      window.__gcse.searchCallbacks.web.rendered();
    };
    const element = {execute(query){window.googleFixtureQueries.push(query);result(query)},clearAllResults(){}};
    window.google = {search:{cse:{element:{render(config){
      config.div.innerHTML='<div class="gsc-control-cse"><div>Powered by Google (test fixture)</div><div data-google-fixture-organic></div><button type="button" data-google-fixture-next>Google page 2</button></div>';
      resultDiv=config.div.querySelector('[data-google-fixture-organic]');
      config.div.querySelector('[data-google-fixture-next]').onclick=()=>result(window.googleFixtureQueries.at(-1),true);
    },getElement(){return element}}}}};
    const widget = document.querySelector('[data-google-jobs-host]');
    widget.addEventListener('click', event => event.stopPropagation());
    widget.addEventListener('change', event => event.stopPropagation());
    window.__gcse.initializationCallback();
  `,
    }),
  );
  await context.route("**/api/jobs/search*", (route) => {
    searchRequests++;
    const url = new URL(route.request().url());
    source = url.searchParams.get("source");
    const query = url.searchParams.get("q").toLowerCase();
    const feed = source === "jobicy" ? [jobs[1]] : jobs;
    return route.fulfill({
      json: {
        jobs: feed.filter((job) =>
          [job.title, job.company, job.description]
            .join(" ")
            .toLowerCase()
            .includes(query),
        ),
        message: "Test feed",
        configured: true,
      },
    });
  });
  await context.route("**/api/workspace/items", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items } });
    const input = route.request().postDataJSON();
    assert.ok(route.request().headers()["x-csrf-token"]);
    assert.equal(input.kind, "application");
    assert.equal(input.payload.status, "Saved");
    writes.push(input);
    if (delaySave) {
      const hold = delaySave;
      delaySave = null;
      await hold;
    }
    if (input.payload.jobId === "bulk-2" && rejectOnce) {
      rejectOnce = false;
      return route.fulfill({
        status: 503,
        json: { error: "Test save failure. Please retry." },
      });
    }
    const item = {
      id: items.length + 1,
      kind: input.kind,
      payload: input.payload,
    };
    items.push(item);
    await route.fulfill({ json: { item } });
  });
  await page.clock.setFixedTime(listingNow);
  await page.goto("/job-listing");
  await page.locator("[data-ready=true]").waitFor();
  await page.locator("[data-job-pick]").first().waitFor();
  assert.equal(await page.locator("#job-role").count(), 0);
  assert.equal(
    await page
      .locator(
        "[data-google-search], [data-google-job-search], [data-job-sources]",
      )
      .count(),
    0,
  );
  const sourceOptions = await page
    .locator("#job-source option")
    .evaluateAll((options) => options.map((option) => option.value));
  for (const source of ["onlinejobs", "jobstreet", "linkedin", "indeed"])
    assert.equal(sourceOptions.includes(source), false);
  await page.getByLabel("Role or keyword").fill("Company 217");
  await page.getByRole("button", { name: "Search jobs", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-job-count]").textContent === "1 results",
  );
  assert.equal(await page.locator('[data-job-card="bulk-217"]').count(), 1);
  assert.equal(page.url().endsWith("/job-listing"), true);
  await page.getByLabel("Role or keyword").fill("");
  await page.getByLabel("Role or keyword").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-job-count]").textContent === "218 results",
  );
  await page
    .getByLabel("Classification", { exact: true })
    .selectOption("Customer support");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 0);
  await page
    .getByLabel("Classification", { exact: true })
    .selectOption("Development & IT");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  await page.getByLabel("Classification", { exact: true }).selectOption("");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "218 results",
  );
  const initialSearchRequests = searchRequests;
  await page.locator('[data-job-pick="bulk-0"]').check();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  assert.equal(await page.locator('[data-job-pick="bulk-12"]').count(), 1);
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /1 selected/,
  );
  await page.getByRole("button", { name: "Page 19", exact: true }).click();
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Next page", exact: true })
      .isEnabled(),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator(".job-results-panel")
    .screenshot({ path: "auth/runtime/job-pagination-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Page 1", exact: true }).click();
  assert.equal(
    await page.locator('[data-job-pick="bulk-0"]').isChecked(),
    true,
  );
  assert.equal(
    searchRequests,
    initialSearchRequests,
    "Changing result pages must not refetch the feed",
  );
  assert.equal(await page.locator('[data-job-clear-selection]').count(), 0, 'The redundant clear button is removed');
  await page.locator("[data-job-select-all]").uncheck();
  await page.locator('[data-job-pick="bulk-7"]').check();
  await page.getByLabel("Listing time").selectOption("1");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "209 results",
  );
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /1 outside current results/,
  );
  assert.equal(await page.locator('[data-job-select-all]').isChecked(), true);
  assert.equal(await page.locator('[data-job-selection-label]').innerText(), 'Deselect 1 job');
  await page.locator('[data-job-select-all]').uncheck();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/, 'Unchecking also clears jobs hidden by date filters');
  await selectBatch();
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /209 selected/,
  );
  await page.locator("[data-job-select-all]").uncheck();
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /0 selected/,
  );
  await page.locator("[data-job-select-all]").uncheck();
  for (const [days, count] of [
    ["3", 211],
    ["7", 212],
    ["14", 213],
    ["30", 214],
  ]) {
    await page.getByLabel("Listing time").selectOption(days);
    assert.equal(
      await page.locator("[data-job-results] .job-card").count(),
      Math.min(12, count),
    );
    assert.equal(
      await page.locator("[data-job-count]").innerText(),
      `${count} results`,
    );
  }
  await page.getByLabel("Listing time").selectOption("7");
  await page.getByLabel("Place or location").fill("USA");
  await page.getByLabel("Employment type").selectOption("Contract");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "106 results",
  );
  await page.getByLabel("Place or location").fill("No matching location");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 0);
  assert.equal(await page.locator("[data-job-select-all]").isEnabled(), false);
  await page.getByLabel("Place or location").fill("");
  await page.getByLabel("Employment type").selectOption("");
  await page.getByLabel("Listing time").selectOption("");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "218 results",
  );
  await page.locator('[data-job-pick="bulk-0"]').check();
  assert.equal(
    await page.locator("[data-job-details-modal]").isVisible(),
    false,
  );
  assert.equal(
    await page.locator("[data-job-results] .job-card.border-primary").count(),
    1,
  );
  assert.equal(
    await page
      .locator("[data-job-select-all]")
      .evaluate((input) => input.indeterminate),
    false,
  );
  await page.getByLabel("Place or location").fill("USA");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "109 results",
  );
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /1 outside current results/,
  );
  await page.getByLabel('Place or location').fill('No matching location');
  assert.equal(await page.locator('[data-job-select-all]').isEnabled(), true, 'Hidden selections can be cleared with zero matching jobs');
  await page.locator('[data-job-select-all]').uncheck();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/);
  assert.equal(await page.locator('[data-job-select-all]').isEnabled(), false, 'Empty results cannot start a new batch');
  await page.getByLabel('Place or location').fill('USA');
  await selectBatch();
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /109 selected/,
  );
  await page.locator("[data-job-select-all]").uncheck();
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /0 selected/,
  );
  await page.getByLabel("Place or location").fill("");
  await page.getByLabel("Employment type").selectOption("Contract");
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 12);
  assert.equal(
    await page.locator("[data-job-count]").innerText(),
    "109 results",
  );
  await page.getByLabel("Employment type").selectOption("");
  await page.locator('[data-job-pick="bulk-0"]').check();
  await page.getByLabel("Search feed").selectOption("jobicy");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-job-results] .job-card").length === 1,
  );
  assert.equal(source, "jobicy");
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /1 outside current results/,
  );
  await page.locator("[data-job-select-all]").uncheck();
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/, 'Switching feeds does not prevent clearing hidden selections');
  assert.equal(await page.locator("[data-job-bulk-save]").isEnabled(), false);
  await page.getByLabel("Search feed").selectOption("all");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-job-count]").textContent === "218 results",
  );
  await page.locator('[data-job-pick="bulk-1"]').check();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-job-bulk-export]").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  assert.ok(csv.includes("Software Developer 1"));
  assert.ok(!csv.includes("Software Developer 0"));
  await selectBatch();
  let releaseSave;
  delaySave = new Promise((resolve) => {
    releaseSave = resolve;
  });
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-job-selection-toolbar]")
        .getAttribute("aria-busy") === "true",
  );
  assert.equal(await page.locator("[data-job-select-all]").isEnabled(), false);
  releaseSave();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-job-bulk-status]")
        .textContent.includes("could not be saved"),
    null,
    { timeout: 90000 },
  );
  assert.equal(items.length, 218);
  assert.equal(items[0].payload.status, "Applied");
  assert.equal(writes.length, 218);
  assert.match(
    await page.locator("[data-job-bulk-status]").innerText(),
    /217 jobs saved.*1 could not be saved/,
  );
  assert.equal(
    await page.locator('[data-job-pick="bulk-2"]').isChecked(),
    true,
  );
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-job-selected-count]")
      .textContent.startsWith("0 selected"),
  );
  assert.equal(items.length, 219);
  assert.equal(writes.length, 219);
  await page.locator('[data-job-pick="bulk-1"]').check();
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-job-bulk-status]")
      .textContent.includes("1 already in your tracker"),
  );
  assert.equal(writes.length, 219);
  await selectBatch();
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /218 selected/,
  );
  assert.equal(
    await page.locator('[data-job-pick="bulk-1"]').isChecked(),
    true,
  );
  assert.equal(
    await page.locator('[data-job-pick="bulk-1"]').isEnabled(),
    true,
  );
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-job-bulk-status]")
      .textContent.includes("218 already in your tracker"),
  );
  assert.equal(items.length, 219);
  assert.equal(writes.length, 219);
  await page.reload();
  await page.locator("[data-ready=true]").waitFor();
  await page.locator('[data-job-pick="bulk-1"]').check();
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-job-bulk-status]")
      .textContent.includes("1 already in your tracker"),
  );
  assert.equal(writes.length, 219);
  await page.getByLabel("Role or keyword").fill("Developer 217");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-job-results] .job-card").length === 1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-job-results] [data-job-pick]").check();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "auth/runtime/job-bulk-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "auth/runtime/job-bulk-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Role or keyword").fill("");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-job-count]").textContent === "218 results",
  );
  await page
    .locator(".job-results-panel")
    .screenshot({ path: "auth/runtime/job-pagination-desktop.png" });
  await page.locator("[data-job-select-all]").uncheck();
  await page.getByLabel("Search feed").selectOption("google");
  await page.waitForFunction(
    () => document.querySelectorAll(".google-job-card").length === 2,
  );
  assert.equal(await page.locator("[data-job-results] .job-card").count(), 0);
  assert.match(
    await page.locator("[data-job-selection-scope]").innerText(),
    /This Google results page/,
  );
  assert.equal(await page.evaluate(() => window.googleInjection), undefined);
  await page.locator(".google-job-card [data-job-details]").first().click();
  await page.locator("[data-job-details-modal]").waitFor({ state: "visible" });
  assert.match(
    await page.locator("[data-details-description]").innerText(),
    /Google search summary/,
  );
  assert.equal(
    await page
      .locator("[data-details-source] [data-job-source-website]")
      .getAttribute("href"),
    "https://jobs.lever.co",
  );
  await page
    .getByRole("button", { name: "Close job details", exact: true })
    .click();
  await page.locator(".google-job-card").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-job-details-modal]").waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Close job details", exact: true })
    .click();
  const sourceWindow = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Visit jobs.lever.co website", exact: true })
    .click();
  const sourcePopup = await sourceWindow;
  await sourcePopup.waitForURL("https://jobs.lever.co/");
  assert.equal(
    await sourcePopup.getByRole("heading").innerText(),
    "Source website",
  );
  await sourcePopup.close();
  await page.waitForFunction(
    () => !document.querySelector(".google-job-card [data-source-icon]"),
  );
  assert.equal(
    await page
      .locator('.google-job-card svg[aria-label="Source icon unavailable"]')
      .count(),
    2,
  );
  await page
    .getByLabel("Classification", { exact: true })
    .selectOption("Finance & operations");
  await page.waitForFunction(() =>
    window.googleFixtureQueries.at(-1).includes("accountant"),
  );
  await page.getByLabel("Listing time").selectOption("7");
  await page.waitForFunction(() =>
    window.googleFixtureQueries.at(-1).includes("after:2026-10-05"),
  );
  await page.getByLabel("Place or location").fill("Manila");
  await page.waitForFunction(() =>
    window.googleFixtureQueries.at(-1).includes("Manila"),
  );
  await selectBatch();
  await page.locator("[data-job-bulk-save]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-job-bulk-status]")
      .textContent.includes("2 jobs saved"),
  );
  assert.equal(items.length, 221);
  assert.ok(
    items.some(
      (item) =>
        item.payload.url ===
        "https://www.onlinejobs.ph/jobseekers/job/assistant-123",
    ),
  );
  assert.equal(
    items.at(-1).payload.company,
    "",
    "Do not invent employer details from a Google search snippet",
  );
  await page.locator(".google-job-card [data-job-pick]").first().check();
  await page
    .getByRole("button", { name: "Google page 2", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".google-job-card").length === 1,
  );
  assert.match(
    await page.locator("[data-job-selected-count]").innerText(),
    /1 outside current results/,
  );
  await page.locator('[data-job-select-all]').press('Space');
  assert.match(await page.locator('[data-job-selected-count]').innerText(), /^0 selected/, 'Keyboard deselection clears previous Google pages');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator(".job-results-panel")
    .screenshot({ path: "auth/runtime/google-jobs-mobile.png" });
  await page.getByLabel("Search feed").selectOption("jobicy");
  await page.locator("[data-google-jobs]").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  if (process.env.JOBLINK_VERIFY_GOOGLE_LIVE === "1") {
    await context.unroute("https://cse.google.com/cse.js?cx=*");
    const googleResponses = [];
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (
        url.hostname === "cse.google.com" &&
        (url.pathname.includes("element/v1") ||
          url.pathname.endsWith("/cse.js"))
      )
        googleResponses.push({ path: url.pathname, status: response.status() });
      if (
        url.hostname === "cse.google.com" &&
        url.pathname.includes("element/v1")
      ) {
        try {
          const raw = await response.text();
          const data = JSON.parse(
            raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
          );
          console.log(
            JSON.stringify({
              googleProviderResultCount: data.results?.length,
              estimatedCount: data.cursor?.estimatedResultCount,
              urls: data.results?.slice(0, 4).map((result) => result.url),
              providerError: data.error?.message,
            }),
          );
        } catch {
          /* A failed diagnostic does not change the application check. */
        }
      }
    });
    await page.reload();
    await page.locator("[data-ready=true]").waitFor();
    await page.getByLabel("Search feed").selectOption("google");
    await page.getByLabel("Role or keyword").fill("virtual assistant");
    await page
      .getByRole("button", { name: "Search jobs", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-google-jobs]")
          .getAttribute("aria-busy") === "false",
      null,
      { timeout: 30000 },
    );
    console.log(
      JSON.stringify({
        liveGoogle: true,
        status: await page.locator("[data-google-jobs-status]").innerText(),
        cards: await page.locator(".google-job-card").count(),
        responses: googleResponses,
      }),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".google-job-card").length > 0,
    );
    await page.locator(".google-job-card [data-job-details]").first().click();
    await page
      .locator("[data-job-details-modal]")
      .waitFor({ state: "visible" });
    assert.ok(await page.locator("[data-details-apply]").getAttribute("href"));
    await page
      .getByRole("button", { name: "Close job details", exact: true })
      .click();
    await page
      .locator(".job-results-panel")
      .screenshot({ path: "auth/runtime/google-jobs-live.png" });
  }
  console.log(
    "PASS: classification, shared keyword search with Google, job-only URL filtering, safe snippets, Google paging and bulk save, 218 feed results, caches, filters, status preservation, retry, CSRF and mobile layout.",
  );
} finally {
  await browser.close();
  if (process.env.JOBLINK_BACKEND === "supabase") {
    const { db, query } = await import("../jobfinder/preview/server/core.mjs");
    const user = await query(
      db().from("users").select("id").eq("email", email).maybeSingle(),
    );
    if (user) {
      await query(db().from("workspace_items").delete().eq("user_id", user.id));
      await query(
        db().from("joblink_sessions").delete().eq("user_id", user.id),
      );
      await query(db().from("users").delete().eq("id", user.id));
    }
  } else
    execFileSync(
      "C:/xampp/php/php.exe",
      [
        fileURLToPath(new URL("./test-account.php", import.meta.url)),
        email,
        "cleanup",
      ],
      { stdio: "inherit" },
    );
}
