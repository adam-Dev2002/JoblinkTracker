import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { loadEnv } from "../jobfinder/node_modules/vite/dist/node/index.js";
const environment = loadEnv(
  "development",
  fileURLToPath(new URL("../jobfinder/preview/", import.meta.url)),
  "",
);
for (const [key, value] of Object.entries(environment))
  process.env[key] ??= value;
const email = `auth-test-${Date.now()}@example.invalid`,
  php = fileURLToPath(new URL("./test-account.php", import.meta.url));
const b = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const c = await b.newContext({ baseURL: process.env.JOBLINK_BASE_URL || "http://127.0.0.1:3000" }),
  p = await c.newPage();
p.setDefaultNavigationTimeout(90000);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const jobs = [
  {
    id: "apply-test-1",
    title: "Virtual Assistant",
    company: "Example Company",
    location: "Philippines, Manila",
    role: "Virtual assistance",
    url: "https://example.com/careers/apply",
    source: "Company careers",
    salary: "PHP 35,000",
    date: "2026-10-10",
    direct: true,
    logo: "https://example.com/logo.png",
    workMode: "Remote / WFH",
  },
  {
    id: "apply-test-2",
    title: "Office Assistant",
    company: "Other Company",
    location: "USA",
    role: "Virtual assistance",
    url: "https://example.com/jobs/2",
    source: "Test Source",
    salary: "",
    date: "2026-10-10",
    direct: false,
    logo: "https://example.com/missing-logo.png",
    workMode: "Check listing",
  },
];
try {
  const s = await (await c.request.get("/api/auth/session")).json();
  assert.equal(
    (
      await c.request.post("/api/auth/register", {
        data: {
          name: "Apply Test",
          email,
          password: "Test-only-password-2026",
        },
        headers: { "X-CSRF-Token": s.csrf },
      })
    ).status(),
    201,
  );
  await c.route("**/api/jobs/search*", (r) =>
    r.fulfill({ json: { jobs, configured: true, message: "Test feed" } }),
  );
  await c.route("https://example.com/logo.png", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>',
    }),
  );
  await c.route("https://example.com/missing-logo.png", (r) => r.abort());
  await c.route("https://example.com/careers/apply", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<h1>Official application form</h1>",
    }),
  );
  await c.route(jobs[1].url, (r) =>
    r.fulfill({ contentType: "text/html", body: "<h1>Source listing</h1>" }),
  );
  const writes = [];
  c.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspace/items")
      writes.push(request.postDataJSON());
  });
  await p.goto("/job-listing");
  await p.locator("[data-ready=true]").waitFor();
  await p.locator("[data-apply-job]").first().waitFor();
  await p.locator('[data-ready="true"]').waitFor();
  assert.equal(await p.locator(".job-card").count(), 2);
  assert.equal(await p.locator(".job-card [data-mark-applied-job]").count(), 2);
  await p
    .locator("[data-company-logo]")
    .first()
    .evaluate((i) =>
      i.complete
        ? Promise.resolve()
        : new Promise((resolve) =>
            i.addEventListener("load", resolve, { once: true }),
          ),
    );
  assert.equal(
    await p.locator("[data-company-logo]").first().getAttribute("alt"),
    "Example Company logo",
  );
  await p.getByLabel("Place or location").fill("Manila");
  assert.equal(await p.locator(".job-card").count(), 1);
  await p.getByLabel("Place or location").fill("");
  const popupPromise = p.waitForEvent("popup");
  await p.getByRole("link", { name: "Apply on company site" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://example.com/careers/apply");
  assert.equal(
    await popup.getByRole("heading").innerText(),
    "Official application form",
  );
  await popup.close();
  assert.equal(await p.locator("[data-application-modal], .modal-backdrop").count(), 0);
  let rows = (await (await c.request.get("/api/workspace/items")).json()).items;
  assert.equal(rows.length, 0, 'Opening a company application page does not create a tracker record');
  assert.equal(writes.length, 0, 'Apply sends no workspace write');
  assert.equal(await p.locator("[data-application-notice]").count(), 0);
  const secondPopup = p.waitForEvent("popup");
  await p.getByRole("link", { name: "Apply on company site" }).click();
  const other = await secondPopup;
  await other.waitForURL("https://example.com/careers/apply");
  await other.close();
  rows = (await (await c.request.get("/api/workspace/items")).json()).items;
  assert.equal(rows.length, 0, 'Repeated Apply clicks leave the tracker empty');
  assert.equal(writes.length, 0);
  let rejectConfirmation = true;
  await c.route("**/api/workspace/items", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.postDataJSON()?.payload?.status === "Applied" &&
      rejectConfirmation
    ) {
      rejectConfirmation = false;
      await route.fulfill({
        status: 503,
        json: { error: "Test save failure. Please retry." },
      });
    } else await route.continue();
  });
  await p.locator('[data-job-card="apply-test-1"] [data-mark-applied-job]').click();
  await p
    .locator("[data-workspace-error]")
    .filter({ hasText: "Test save failure" })
    .waitFor();
  assert.equal((await (await c.request.get("/api/workspace/items")).json()).items.length, 0, 'A failed explicit confirmation does not create a record');
  await p.locator('[data-job-card="apply-test-1"] [data-mark-applied-job]').click();
  await p.locator('[data-job-card="apply-test-1"]').waitFor({ state: 'detached' });
  assert.equal(await p.locator('[data-job-card="apply-test-1"]').count(), 0);
  await p.goto("/applications");
  await p.locator("[data-ready=true]").waitFor();
  assert.equal(await p.locator("[data-entry-status]").inputValue(), "Applied");
  assert.equal((await (await c.request.get('/api/workspace/items')).json()).items[0].payload.logo, jobs[0].logo);
  await p.getByRole('button', { name: 'Actions for Virtual Assistant', exact: true }).click();
  await p.getByRole('menuitem', { name: 'Edit application', exact: true }).click();
  await p.locator('[data-entry-form] button[type=submit]').click();
  await p.locator('[data-entry-modal]').waitFor({ state: 'hidden' });
  const edited = (await (await c.request.get('/api/workspace/items')).json()).items[0];
  assert.equal(edited.payload.logo, jobs[0].logo, 'Logos survive a real backend form update');
  assert.equal(edited.payload.jobId, jobs[0].id);
  const logoSession = await (await c.request.get('/api/auth/session')).json();
  for (const logo of ['javascript:alert(1)', '/static/company-logos/../../private.svg', 'https://name:secret@example.com/logo.png']) {
    assert.equal((await c.request.post('/api/workspace/items', { data: { id: edited.id, kind: 'application', payload: { ...edited.payload, logo } }, headers: { 'X-CSRF-Token': logoSession.csrf } })).status(), 422);
  }
  assert.equal(
    await p
      .locator("[data-application-rows]")
      .getByText("Example Company", { exact: true })
      .count(),
    1,
  );
  const session = await (await c.request.get("/api/auth/session")).json();
  const payload = {
    title: jobs[0].title,
    company: jobs[0].company,
    url: jobs[0].url,
    jobId: jobs[0].id,
    source: jobs[0].source,
    status: "Application opened",
    date: "2026-10-10",
  };
  const repeat = await c.request.post("/api/workspace/items", {
    data: { kind: "application", action: "open-application", payload },
    headers: { "X-CSRF-Token": session.csrf },
  });
  assert.equal((await repeat.json()).item.payload.status, "Applied");
  assert.equal(
    (
      await c.request.post("/api/workspace/items", {
        data: { kind: "application", action: "open-application", payload },
      })
    ).status(),
    403,
  );
  await p.goto("/job-listing");
  await p.locator("[data-apply-job]").first().waitFor();
  await p.locator('[data-ready="true"]').waitFor();
  await p.locator('[data-job-card="apply-test-1"]').waitFor({ state: 'detached' });
  assert.equal(await p.locator('.job-card').count(), 1);
  await p.locator('[data-track="apply-test-2"]').click();
  await p.locator('[data-entry-modal]').waitFor({ state: 'visible' });
  await p.locator('[data-entry-form] button[type=submit]').click();
  await p.locator('[data-entry-modal]').waitFor({ state: 'hidden' });
  const bookmarked = (await (await c.request.get('/api/workspace/items')).json()).items.find(item => item.payload.jobId === jobs[1].id);
  assert.equal(bookmarked.payload.logo, jobs[1].logo, 'Saving through the job card preserves its logo');
  assert.equal(bookmarked.payload.source, jobs[1].source);
  await p.setViewportSize({ width: 390, height: 844 });
  const mobilePopupPromise = p.waitForEvent("popup");
  await p.getByRole("link", { name: "Apply via source" }).click();
  const mobilePopup = await mobilePopupPromise;
  await mobilePopup.waitForURL(jobs[1].url);
  await mobilePopup.close();
  const afterOpening = (await (await c.request.get('/api/workspace/items')).json()).items.find(item => item.id === bookmarked.id);
  assert.deepEqual(afterOpening, bookmarked, 'Opening a saved source listing leaves its tracker record unchanged');
  assert.equal(await p.locator("[data-application-modal], .modal-backdrop").count(), 0);
  await p.locator('[data-job-card="apply-test-2"] [data-mark-applied-job]').waitFor();
  assert.equal(await p.locator('[data-job-card="apply-test-2"] [data-mark-applied-job]').isVisible(), true);
  const buttonBounds = await p
    .locator('[data-job-card="apply-test-2"] [data-mark-applied-job]')
    .boundingBox();
  assert.ok(buttonBounds.x >= 0 && buttonBounds.x + buttonBounds.width <= 390);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await p.locator('[data-job-card="apply-test-2"] [data-mark-applied-job]').click();
  await p.locator('[data-job-card="apply-test-2"]').waitFor({ state: 'detached' });
  assert.equal((await (await c.request.get('/api/workspace/items')).json()).items.find(item => item.id === bookmarked.id).payload.status, 'Applied');
  assert.deepEqual(errors, []);
  console.log(
    "PASS: company/source opening without automatic tracking, repeated clicks, saved-record preservation, explicit Applied persistence, failed-save retry, logos, CSRF and mobile layout.",
  );
} finally {
  await b.close();
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
    execFileSync("C:/xampp/php/php.exe", [php, email, "cleanup"], {
      stdio: "inherit",
    });
}
