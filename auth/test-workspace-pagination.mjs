import assert from "node:assert/strict";
import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { loadEnv } from "../jobfinder/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
for (const [key, value] of Object.entries(
  loadEnv(
    "development",
    fileURLToPath(new URL("../jobfinder/preview/", import.meta.url)),
    "",
  ),
))
  process.env[key] ??= value;
const email = `auth-test-pagination-${Date.now()}@example.invalid`;
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({
  baseURL: "http://127.0.0.1:3000",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let items = [
  ...Array.from({ length: 22 }, (_, index) => {
    const id = 22 - index;
    return {
      id,
      kind: "application",
      attachments: [],
      payload: {
        title: `Application ${id}`,
        company: "Test company",
        url: `https://example.com/jobs/${id}`,
        salary: "",
        status: id % 2 ? "Saved" : "Applied",
        notes: "",
        date: "2026-10-12",
      },
    };
  }),
  ...Array.from({ length: 21 }, (_, index) => ({
    id: 125 - index,
    kind: "sheet",
    attachments: [],
    payload: {
      title: `Sheet row ${125 - index}`,
      company: index % 2 ? "Other" : "Acme",
      value: "",
      notes: "",
    },
  })),
];
let nextId = 126,
  readRequests = 0,
  delayWrite = null;
const pager = () =>
  page.locator("[data-application-pagination], [data-sheet-pagination]");
async function choosePage(number) {
  await pager()
    .getByRole("button", { name: `Page ${number}`, exact: true })
    .click();
  await page.waitForFunction(
    (number) =>
      document.querySelector('.workspace-pagination [aria-current="page"]')
        ?.textContent === String(number),
    number,
  );
  assert.equal(await pager().locator('[aria-current="page"]').count(), 1);
}
async function deleteRow(button) {
  const id = await button.getAttribute("data-delete");
  await button.click();
  await page.locator("[data-confirm-accept]").click();
  await page.locator(`[data-delete="${id}"]`).waitFor({ state: "hidden" });
  await page.waitForFunction(id => !document.querySelector(`[data-application-actions="${id}"], [data-sheet-id="${id}"]`), id);
}
async function deleteApplication(title) {
  await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click();
  await deleteRow(page.getByRole('menuitem', { name: `Delete ${title}`, exact: true }));
}
async function filterApplicationStatus(value) {
  await page.locator('[data-application-filter-toggle]').click();
  await page.getByLabel('Filter application status').selectOption(value);
  await page.locator('[data-application-filter-toggle]').click();
}
async function tableMetrics() {
  return page.locator('.workspace-table').evaluate(table => {
    const cell = table.querySelector('tbody td');
    const style = getComputedStyle(cell);
    const search = table.querySelector('input[type=search]');
    const actions = table.querySelector('[data-application-actions], [data-sheet-actions]');
    return { font: style.fontSize, verticalPadding: style.paddingTop, horizontalPadding: style.paddingLeft, rowHeight: table.querySelector('tbody tr').getBoundingClientRect().height, searchHeight: search.getBoundingClientRect().height, actionHeight: actions.getBoundingClientRect().height };
  });
}
try {
  const session = await (await context.request.get("/api/auth/session")).json();
  const response = await context.request.post("/api/auth/register", {
    data: {
      name: "Pagination Test",
      email,
      password: "Test-only-password-2026",
    },
    headers: { "X-CSRF-Token": session.csrf },
  });
  assert.equal(response.status(), 201);
  await context.route("**/api/workspace/items", async (route) => {
    if (route.request().method() === "GET") {
      readRequests++;
      return route.fulfill({ json: { items } });
    }
    const input = route.request().postDataJSON();
    assert.ok(route.request().headers()["x-csrf-token"]);
    if (input.action === "delete") {
      items = items.filter((item) => item.id !== input.id);
      return route.fulfill({ json: { deleted: input.id } });
    }
    if (delayWrite) {
      const hold = delayWrite;
      delayWrite = null;
      await hold;
    }
    const index = items.findIndex((item) => item.id === input.id);
    const item = {
      id: input.id || nextId++,
      kind: input.kind,
      payload: input.payload,
      attachments: [],
    };
    if (index >= 0) items[index] = item;
    else items.unshift(item);
    return route.fulfill({ json: { item } });
  });
  await page.goto('/dashboard');
  await page.locator('[data-ready=true]').waitFor();
  const dashboardPager = page.locator('[data-dashboard-pagination]');
  const dashboardReads = readRequests;
  assert.equal(await page.locator('[data-dashboard-applications] tbody tr').count(), 7);
  await dashboardPager.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.equal(await page.locator('[data-dashboard-applications] tbody tr').count(), 7);
  await dashboardPager.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.equal(await page.locator('[data-dashboard-applications] tbody tr').count(), 7);
  await dashboardPager.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.equal(await page.locator('[data-dashboard-applications] tbody tr').count(), 1);
  assert.match(await dashboardPager.innerText(), /Showing 22–22 of 22 applications/);
  assert.equal(await dashboardPager.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
  assert.equal(readRequests, dashboardReads, 'Dashboard pages reuse the loaded workspace');
  await page.goto("/applications");
  await page.locator("[data-ready=true]").waitFor();
  assert.equal(await page.locator("[data-application-rows] tr").count(), 10);
  assert.equal(
    await page.locator("[data-application-stat=total]").innerText(),
    "22",
  );
  const readsBeforePages = readRequests;
  await choosePage(3);
  assert.equal(await page.locator("[data-application-rows] tr").count(), 2);
  assert.equal(
    await pager()
      .getByRole("button", { name: "Next page", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(readRequests, readsBeforePages);
  await page.getByLabel("Search applications").fill("Application 22");
  assert.equal(await page.locator("[data-application-rows] tr").count(), 1);
  assert.equal(await pager().isVisible(), false);
  await page.getByLabel("Search applications").fill("");
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "1");
  await filterApplicationStatus('Saved');
  await choosePage(2);
  assert.equal(await page.locator("[data-application-rows] tr").count(), 1);
  await filterApplicationStatus('');
  await choosePage(2);
  await page.getByLabel("Status for Application 12").selectOption("Interview");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-application-stat=interview]")
        .textContent === "1",
  );
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "2");
  await choosePage(3);
  await deleteApplication('Application 1');
  assert.equal(await page.locator("[data-application-rows] tr").count(), 1);
  await deleteApplication('Application 2');
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "2");
  assert.equal(await page.locator("[data-application-rows] tr").count(), 10);
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  await page
    .getByLabel("Title / role", { exact: true })
    .fill("New application");
  await page.locator("[data-entry-form] button[type=submit]").click();
  await page.locator("[data-entry-modal]").waitFor({ state: "hidden" });
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "1");
  assert.equal(
    await page
      .locator("[data-application-rows]")
      .getByText("New application", { exact: true })
      .count(),
    1,
  );
  await page.locator('.table-responsive').evaluate(element => { element.scrollLeft = 0; });
  await page
    .locator("[data-application-table]")
    .screenshot({ path: "auth/runtime/application-pagination-desktop.png" });
  const applicationMetrics = await tableMetrics();
  assert.equal(applicationMetrics.font, '14px');
  assert.ok(applicationMetrics.rowHeight >= 78, 'Application rows have comfortable height');
  assert.ok(applicationMetrics.searchHeight >= 39 && applicationMetrics.actionHeight >= 39);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#jobify-sidebar").evaluate(async (element) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.allSettled(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator("[data-application-table]")
    .screenshot({ path: "auth/runtime/application-pagination-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/desk/sheet");
  await page.locator("[data-ready=true]").waitFor();
  assert.deepEqual(await tableMetrics(), applicationMetrics, 'Application and Sheet use the same table spacing, type, row height, and controls');
  await page.locator('[data-sheet-actions="125"]').click();
  assert.equal(await page.locator('[data-sheet-actions="125"] svg.workspace-action-chevron').count(), 1);
  assert.equal(await page.locator('[data-sheet-table] .card-footer:not(.workspace-pagination)').count(), 0, 'The redundant sheet footer is removed');
  await page.getByRole('menuitem', { name: 'Edit row / attachments', exact: true }).click();
  await page.locator('[data-entry-modal]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#entry-attachments').count(), 1, 'Shared row menu preserves sheet attachments');
  await page.locator('[data-entry-modal]').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('[data-entry-modal]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator("[data-sheet-rows] tr").count(), 10);
  await page.locator('[data-sheet-pick="125"]').check();
  await choosePage(2);
  assert.equal(
    await page
      .locator("[data-sheet-rows] tr")
      .first()
      .locator("td")
      .nth(1)
      .innerText(),
    "11",
  );
  await page.locator('[data-sheet-pick="113"]').check();
  await choosePage(1);
  assert.equal(await page.locator('[data-sheet-pick="125"]').isChecked(), true);
  assert.match(
    await page.locator("[data-sheet-selected-count]").innerText(),
    /2 selected.*1 on other pages/,
  );
  await page.getByRole('button', { name: 'Selected actions', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Selected actions', exact: true }).locator('svg.workspace-action-chevron').count(), 1);
  const bulkDelete = page.locator('[data-sheet-bulk]');
  await bulkDelete.hover();
  const bulkColors = await bulkDelete.evaluate(node => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'var(--tblr-danger)';
    node.append(sample);
    const expected = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return { actual: getComputedStyle(node).backgroundColor, expected };
  });
  assert.equal(bulkColors.actual, bulkColors.expected, 'Bulk Delete highlights red');
  const selectedDownloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export selected', exact: true }).click();
  const selectedDownload = await selectedDownloadReady;
  let selectedCsv = '';
  for await (const chunk of await selectedDownload.createReadStream()) selectedCsv += chunk;
  assert.equal(selectedCsv.trim().split('\r\n').length, 3);
  assert.ok(selectedCsv.includes('Sheet row 125') && selectedCsv.includes('Sheet row 113'));
  await page.getByLabel("Select all filtered sheet rows across pages").check();
  assert.match(await page.locator("[data-sheet-bulk]").innerText(), /21/);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter sheet company").selectOption("Acme");
  assert.match(
    await page.locator("[data-sheet-selected-count]").innerText(),
    /10 selected outside current filters/,
  );
  await page
    .getByLabel("Select all filtered sheet rows across pages")
    .uncheck();
  assert.match(
    await page.locator("[data-sheet-selected-count]").innerText(),
    /10 selected/,
  );
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await page.getByLabel("Sort sheet").selectOption("oldest");
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  assert.equal(
    await page.locator("[data-sheet-field=title]").first().inputValue(),
    "Sheet row 105",
  );
  await choosePage(2);
  let releaseWrite;
  delayWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  await page
    .locator('[data-sheet-id="125"][data-sheet-field=value]')
    .fill("42");
  const writeStarted = page.waitForRequest(
    (request) =>
      request.url().includes("/api/workspace/items") &&
      request.method() === "POST",
  );
  await pager().getByRole("button", { name: "Page 1", exact: true }).click();
  await writeStarted;
  assert.equal(
    await pager().locator("[aria-current=page]").innerText(),
    "2",
    "Keep the edited page until its queued save completes",
  );
  releaseWrite();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-sheet-pagination] [aria-current=page]")
        ?.textContent === "1",
  );
  await choosePage(2);
  assert.equal(
    await page
      .locator('[data-sheet-id="125"][data-sheet-field=value]')
      .inputValue(),
    "42",
  );
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.locator("[data-sheet-column-toggle][value=notes]").uncheck();
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await choosePage(1);
  assert.equal(
    await page.locator("th[data-sheet-column=notes]").isVisible(),
    false,
  );
  await page.getByLabel("Search sheet").fill("no matching row");
  assert.equal(await page.locator("[data-sheet-rows] tr").count(), 0);
  assert.equal(await pager().isVisible(), false);
  assert.equal(await page.locator("[data-sheet-all]").isEnabled(), false);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole('button', { name: 'Selected actions', exact: true }).click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page.getByLabel('Select all filtered sheet rows across pages').check();
  assert.match(await page.locator("[data-sheet-bulk]").innerText(), /21/);
  await page.getByRole('button', { name: 'Selected actions', exact: true }).click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await choosePage(3);
  const sheetActions = page.locator('[data-sheet-actions]').first();
  const sheetId = await sheetActions.getAttribute('data-sheet-actions');
  await sheetActions.click();
  await deleteRow(page.locator(`[data-table-delete][data-delete="${sheetId}"]`));
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "2");
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await page.getByLabel("Sort sheet").selectOption("newest");
  await page.getByRole("button", { name: "Sort by", exact: true }).click();
  await choosePage(2);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByLabel("Title / role", { exact: true }).fill("New sheet row");
  await page.locator("[data-entry-form] button[type=submit]").click();
  await page.locator("[data-entry-modal]").waitFor({ state: "hidden" });
  assert.equal(await pager().locator("[aria-current=page]").innerText(), "1");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloading;
  let csv = "";
  for await (const chunk of await download.createReadStream()) csv += chunk;
  assert.ok(csv.includes("Sheet row 105"));
  assert.ok(csv.includes("New sheet row"));
  await page.locator('.table-responsive').evaluate(element => { element.scrollLeft = 0; });
  await page
    .locator("[data-sheet-table]")
    .screenshot({ path: "auth/runtime/sheet-pagination-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#jobify-sidebar").evaluate(async (element) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.allSettled(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator("[data-sheet-table]")
    .screenshot({ path: "auth/runtime/sheet-pagination-mobile.png" });
  const sheetRows = items.filter(item => item.kind === 'sheet');
  const otherItems = items.filter(item => item.kind !== 'sheet');
  items = [...otherItems, ...sheetRows.slice(0, 13)];
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  assert.equal(await page.locator('[data-sheet-rows] tr').count(), 10);
  assert.match(await pager().innerText(), /Showing 1–10 of 13 rows/);
  await pager().getByRole('button', { name: 'Next page', exact: true }).click();
  assert.equal(await page.locator('[data-sheet-rows] tr').count(), 3);
  assert.match(await pager().innerText(), /Showing 11–13 of 13 rows/);
  assert.equal(await pager().getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
  await pager().getByRole('button', { name: 'Previous page', exact: true }).click();
  assert.equal(await page.locator('[data-sheet-rows] tr').count(), 10);
  items = [...otherItems, ...sheetRows.slice(0, 10)];
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  assert.equal(await page.locator('[data-sheet-rows] tr').count(), 10);
  assert.equal(await pager().isVisible(), false, 'Exactly 10 rows fit on one page');
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 10-row pagination on Applications/Sheet and 7-row dashboard pagination, table counts, no page refetch, filters/sort, edit preservation, cross-page selection, queued cell save, delete clamping, CSV and mobile layout.",
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
