import assert from "node:assert/strict";
import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { loadEnv } from "../jobfinder/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
for (const [key, value] of Object.entries(
  loadEnv(
    "development",
    fileURLToPath(new URL("../jobfinder/preview/", import.meta.url)),
    "",
  ),
))
  process.env[key] ??= value;
const { db, query } = await import("../jobfinder/preview/server/core.mjs");
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const users = [];
try {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 960 },
  });
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  async function register(client, suffix) {
    const { csrf } = await (
      await client.request.get("/api/auth/session")
    ).json();
    const response = await client.request.post("/api/auth/register", {
      headers: { "X-CSRF-Token": csrf },
      data: {
        name: "Sheet Test",
        email: `auth-test-${Date.now() + suffix}@example.invalid`,
        password: "Test-only-password-2026",
      },
    });
    assert.equal(response.status(), 201);
    const data = await response.json();
    users.push(data.user.id);
    return (await (await client.request.get("/api/auth/session")).json()).csrf;
  }
  const csrf = await register(context, 0),
    otherCsrf = await register(other, 1);
  async function save(client, token, kind, title, company = "") {
    const response = await client.request.post("/api/workspace/items", {
      headers: { "X-CSRF-Token": token },
      data: {
        kind,
        payload: { title, company, value: "10", notes: "", status: "To do" },
      },
    });
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    return (await response.json()).item;
  }
  const alpha = await save(context, csrf, "sheet", "Alpha", "Acme");
  await save(context, csrf, "sheet", "Beta", "Other");
  const task = await save(context, csrf, "task", "Keep task");
  const foreign = await save(other, otherCsrf, "sheet", "Private row");
  for (const ids of [
    [alpha.id, foreign.id],
    [alpha.id, task.id],
  ]) {
    const response = await context.request.post("/api/workspace/items", {
      headers: { "X-CSRF-Token": csrf },
      data: { action: "bulk-delete", ids },
    });
    assert.equal(response.status(), 404);
  }
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/desk/sheet", { waitUntil: "domcontentloaded" });
  await page
    .locator("[data-sheet-count]")
    .filter({ hasText: "2 of 2 rows" })
    .waitFor();
  await page
    .getByRole("button", { name: "Hide navigation", exact: true })
    .click();
  assert.equal(
    await page.locator("#jobify-sidebar").evaluate((el) => el.inert),
    true,
  );
  assert.equal(
    await page
      .locator(".jobify-main")
      .evaluate((el) => getComputedStyle(el).marginLeft),
    "0px",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Show navigation", exact: true })
    .click();
  console.log("PASS: desktop sidebar toggles and remembers its state.");
  await page.locator("[data-sheet-rows] tr").first().waitFor();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.locator("#entry-title").fill("Gamma");
  await page.locator("#entry-company").fill("Acme");
  await page.locator('[data-entry-form] button[type="submit"]').click();
  await page
    .locator("[data-sheet-count]")
    .filter({ hasText: "3 of 3 rows" })
    .waitFor();
  const title = page.locator(
    `[data-sheet-id="${alpha.id}"][data-sheet-field="title"]`,
  );
  await title.fill("Alpha updated");
  await page
    .locator(`[data-sheet-id="${alpha.id}"][data-sheet-field="value"]`)
    .fill("42");
  await page.locator("[data-sheet-search]").focus();
  await page.waitForFunction(() => document.querySelector('[data-sheet-save-status]')?.textContent === 'Changes saved.');
  const saved = (
    await (await context.request.get("/api/workspace/items")).json()
  ).items.find((row) => row.id === alpha.id);
  assert.equal(saved.payload.title, "Alpha updated");
  assert.equal(saved.payload.value, "42");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter sheet company").selectOption("Acme");
  assert.equal(await page.locator("[data-sheet-rows] tr").count(), 2);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  assert.equal(await page.locator("[data-sheet-rows] tr").count(), 3);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await page.getByLabel("Sort sheet").selectOption("title");
  assert.equal(
    await page.locator('[data-sheet-field="title"]').first().inputValue(),
    "Alpha updated",
  );
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.locator('[data-sheet-column-toggle][value="notes"]').uncheck();
  assert.equal(
    await page.locator('th[data-sheet-column="notes"]').isVisible(),
    false,
  );
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.locator("[data-sheet-search]").fill("Alpha updated");
  await page.getByLabel('Select sheet rows on this page').check();
  await page.locator("[data-sheet-search]").fill("no match");
  assert.match(
    await page.locator("[data-sheet-empty]").innerText(),
    /No rows match/,
  );
  assert.equal(await page.locator("[data-sheet-selection-toolbar]").isVisible(), false);
  assert.equal(await page.locator("[data-sheet-bulk]").isDisabled(), true);
  await page.locator("[data-sheet-search]").fill("");
  console.log(
    "PASS: add/edit persist in backend; Bootstrap filters, sort, columns and selection work.",
  );
  await query(
    db()
      .from("workspace_items")
      .insert(
        Array.from({ length: 201 }, (_, i) => ({
          user_id: users[0],
          kind: "sheet",
          payload: { title: `Batch ${i}`, company: "", value: "", notes: "" },
        })),
      ),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator("[data-sheet-count]")
    .filter({ hasText: "204 of 204 rows" })
    .waitFor();
  await page.locator('[data-sheet-entries]').selectOption('all');
  await page.getByLabel('Select sheet rows on this page').check();
  await page.locator("[data-sheet-bulk]").click();
  assert.equal(await page.locator('[data-confirm-accept]').innerText(), 'Remove');
  await page
    .locator("[data-confirm-modal]")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(
    (
      await (await context.request.get("/api/workspace/items")).json()
    ).items.filter((row) => row.kind === "sheet").length,
    204,
  );
  assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false);
  await page.locator("[data-sheet-bulk]").click();
  await page.locator("[data-confirm-accept]").click();
  await page
    .locator("[data-sheet-count]")
    .filter({ hasText: "0 of 0 rows" })
    .waitFor();
  await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-removal-success-title]').innerText(), 'Removed successfully');
  assert.match(await page.locator('[data-removal-success-message]').innerText(), /^204 rows were removed\./);
  await page.locator('[data-removal-success-close]').click();
  const remaining = (
    await (await context.request.get("/api/workspace/items")).json()
  ).items;
  assert.deepEqual(
    remaining.map((row) => row.id),
    [task.id],
  );
  assert.equal(
    (await (await other.request.get("/api/workspace/items")).json()).items[0]
      .id,
    foreign.id,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator("[data-sheet-count]")
    .filter({ hasText: "0 of 0 rows" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Show navigation", exact: true })
    .click();
  assert.equal(
    await page.locator("#jobify-sidebar").evaluate((el) => el.inert),
    false,
  );
  await page.locator(".sidebar-close").click();
  assert.equal(
    await page.locator("#jobify-sidebar").evaluate((el) => el.inert),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: bulk removal handles over 200 rows with a success modal, persists after reload, rejects other users/non-sheet rows; mobile sidebar works without page overflow.",
  );
} finally {
  await browser.close();
  for (const id of users) {
    await query(db().from("workspace_items").delete().eq("user_id", id));
    await query(db().from("joblink_sessions").delete().eq("user_id", id));
    await query(db().from("users").delete().eq("id", id));
  }
}
