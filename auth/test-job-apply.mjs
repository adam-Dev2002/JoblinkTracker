import { chromium } from "../tabler-dev/tabler-dev/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const email = `auth-test-${Date.now()}@example.invalid`,
  php = fileURLToPath(new URL("./test-account.php", import.meta.url));
const b = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const c = await b.newContext({ baseURL: "http://localhost:3000" }),
  p = await c.newPage();
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
  await p.goto("/job-listing");
  await p.locator("[data-ready=true]").waitFor();
  await p.locator("[data-apply-job]").first().waitFor();
  assert.equal(await p.locator(".job-card").count(), 2);
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
  await p.getByLabel("Work setup", { exact: true }).selectOption("remote");
  assert.equal(await p.locator(".job-card").count(), 1);
  await p.getByLabel("Work setup", { exact: true }).selectOption("");
  await p.getByLabel("Philippines or worldwide").check();
  assert.equal(await p.locator(".job-card").count(), 1);
  const popupPromise = p.waitForEvent("popup");
  await p.getByRole("link", { name: "Apply on company site" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://example.com/careers/apply");
  assert.equal(
    await popup.getByRole("heading").innerText(),
    "Official application form",
  );
  await popup.close();
  await p.locator("[data-confirm-application]").waitFor();
  let rows = (await (await c.request.get("/api/workspace/items")).json()).items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.status, "Application opened");
  const secondPopup = p.waitForEvent("popup");
  await p.getByRole("link", { name: "Apply on company site" }).click();
  const other = await secondPopup;
  await other.waitForURL("https://example.com/careers/apply");
  await other.close();
  rows = (await (await c.request.get("/api/workspace/items")).json()).items;
  assert.equal(rows.length, 1);
  await p.getByRole("button", { name: "I submitted it", exact: true }).click();
  await p
    .getByRole("status")
    .getByText("is tracked as Applied.", { exact: false })
    .waitFor();
  await p.goto("/applications");
  await p.locator("[data-ready=true]").waitFor();
  assert.equal(await p.locator("[data-entry-status]").inputValue(), "Applied");
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
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: logos/fallback, place/WFH/PH filters, official application tab, automatic opened tracking, duplicate prevention, applied confirmation, status preservation, CSRF and mobile layout.",
  );
} finally {
  await b.close();
  execFileSync("C:/xampp/php/php.exe", [php, email, "cleanup"], {
    stdio: "inherit",
  });
}
