import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const prefix = Date.now();
const emails = [
  `auth-test-${prefix}@example.invalid`,
  `auth-test-${prefix + 1}@example.invalid`,
];
const php = fileURLToPath(new URL("./test-account.php", import.meta.url));
const b = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const ctx = await b.newContext({
  baseURL: "http://localhost:3000",
  viewport: { width: 1440, height: 960 },
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function register(context, email) {
  const session = await (await context.request.get("/api/auth/session")).json();
  const r = await context.request.post("/api/auth/register", {
    data: {
      name: "Workspace Test",
      email,
      password: "Test-only-password-2026",
    },
    headers: { "X-CSRF-Token": session.csrf },
  });
  assert.equal(r.status(), 201);
  return (await (await context.request.get("/api/auth/session")).json()).csrf;
}
async function saveModal(title) {
  await page.getByLabel("Title / role", { exact: true }).fill(title);
  await page
    .locator("[data-entry-form]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("[data-entry-modal]").waitFor({ state: "hidden" });
}
try {
  const token = await register(ctx, emails[0]);
  await page.goto("/");
  await page.locator("[data-workspace-view]").waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".navbar-menu").count(), 0);
  await page.goto("/applications");
  await page.locator("[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Add application" }).click();
  await page.getByLabel("Company", { exact: true }).fill("Test Company");
  await saveModal("Virtual Assistant");
  await page.locator("[data-entry-status]").selectOption("Interview");
  await page.waitForTimeout(250);
  await page.reload();
  await page
    .locator("[data-application-rows]")
    .getByText("Virtual Assistant", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator("[data-entry-status]").inputValue(),
    "Interview",
  );
  const items = (await (await ctx.request.get("/api/workspace/items")).json())
    .items;
  const id = items[0].id;
  assert.equal(
    (
      await ctx.request.post("/api/workspace/items", {
        data: { kind: "task", payload: { title: "Invalid", status: "To do" } },
      })
    ).status(),
    403,
  );
  const other = await b.newContext({ baseURL: "http://localhost:3000" });
  const otherToken = await register(other, emails[1]);
  assert.equal(
    (
      await other.request.post("/api/workspace/items", {
        data: { id, action: "delete" },
        headers: { "X-CSRF-Token": otherToken },
      })
    ).status(),
    404,
  );
  await other.close();
  await page.goto("/desk/taskboard");
  await page.locator("[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Add task" }).click();
  await saveModal("Prepare portfolio");
  await page.locator("[data-entry-status]").selectOption("In progress");
  await page.waitForTimeout(200);
  await page.goto("/desk/calendar");
  await page.locator("[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await saveModal("Interview call");
  await page.getByText("Interview call", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.goto("/desk/links");
  await page.locator("[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Add link" }).click();
  await page
    .getByLabel("Original website URL")
    .fill("https://example.com/careers");
  await saveModal("Company careers");
  await page.getByRole("link", { name: /Company careers/ }).waitFor();
  await page.goto("/desk/sheet");
  await page.locator("[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Add row" }).click();
  await saveModal("Research lead");
  const cell = page.locator('[data-sheet-field="value"]');
  await cell.fill("1200");
  await cell.blur();
  await page.waitForTimeout(250);
  await page.reload();
  await page.locator('[data-sheet-field="value"]').waitFor();
  assert.equal(
    await page.locator('[data-sheet-field="value"]').inputValue(),
    "1200",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /jobify-sheet/);
  await page.goto("/");
  await page
    .locator('[data-stat="applications"]')
    .getByText("1", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "auth/runtime/dashboard-desktop.png",
    fullPage: true,
  });
  await page.goto("/applications");
  await page.locator("[data-ready=true]").waitFor();
  await page.locator("[data-entry-status]").waitFor();
  await page.screenshot({
    path: "auth/runtime/tracker-desktop.png",
    fullPage: true,
  });
  await page.goto("/job-listing");
  await page
    .locator("[data-job-count]")
    .getByText(/results/)
    .waitFor({ timeout: 45000 });
  assert.ok((await page.locator("[data-job-results] .job-card").count()) > 0);
  await page.selectOption("#job-role", "Virtual assistance");
  for (const role of await page
    .locator("[data-job-results] .job-tag")
    .allTextContents())
    assert.equal(role, "Virtual assistance");
  await page.selectOption("#job-role", "");
  await page.screenshot({
    path: "auth/runtime/jobs-desktop.png",
    fullPage: true,
  });
  await page.selectOption("#job-source", "jsearch");
  await page.getByRole("button", { name: "Search jobs", exact: true }).click();
  await page
    .getByText("Philippine job search is not connected yet.", { exact: false })
    .waitFor();
  await page.goto("/news");
  await page
    .locator("[data-news-list] article")
    .first()
    .waitFor({ timeout: 45000 });
  await page.goto("/settings");
  await page.locator("[data-content]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-google-photo]").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Task board" })
    .click();
  await page.locator("[data-task-column]").first().waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "auth/runtime/sidebar-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: sidebar, live jobs/news, classification, application status persistence, task board, calendar, links, editable sheet, CSV, dashboard counts, account isolation, CSRF and mobile navigation.",
  );
} finally {
  await b.close();
  for (const email of emails)
    execFileSync("C:/xampp/php/php.exe", [php, email, "cleanup"], {
      stdio: "inherit",
    });
}
