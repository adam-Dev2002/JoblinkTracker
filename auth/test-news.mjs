import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const email = `auth-test-${Date.now()}@example.invalid`;
const php = fileURLToPath(new URL("./test-account.php", import.meta.url));
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({
  baseURL: "http://localhost:3000",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const initial = await (await context.request.get("/api/auth/session")).json();
  const register = await context.request.post("/api/auth/register", {
    data: { name: "News Reader", email, password: "Test-only-password-2026" },
    headers: { "X-CSRF-Token": initial.csrf },
  });
  assert.equal(register.status(), 201);
  let sessions = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/auth/session")) sessions++;
  });
  await page.goto("/news");
  await page.locator("[data-ready=true]").waitFor();
  await page.locator(".story-card").first().waitFor({ timeout: 45000 });
  assert.ok(sessions <= 1, 'At most one session request; server-rendered pages reuse their session');
  assert.ok((await page.locator(".story-cover").count()) > 0);
  await page
    .locator(".story-cover")
    .first()
    .evaluate((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }),
    );
  await page.screenshot({
    path: "auth/runtime/news-desktop.png",
    fullPage: true,
  });
  const title = await page.locator(".story-card h3").first().innerText();
  await page
    .getByRole("textbox", { name: "Search news" })
    .fill(title.slice(0, 20));
  assert.ok((await page.locator(".story-card").count()) >= 1);
  await page.getByRole("textbox", { name: "Search news" }).fill("");
  await page.locator("[data-news-topic=career]").click();
  assert.equal(
    await page.locator("[data-news-topic=career]").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("[data-news-topic=all]").click();
  await page.locator("[data-read-story]").first().click();
  await page
    .locator("[data-reader-article]")
    .waitFor({ state: "visible", timeout: 45000 });
  assert.ok(
    (await page.locator("[data-reader-body]").innerText()).length > 100,
  );
  assert.match(page.url(), /\/news$/);
  await page.getByRole("button", { name: "Larger text" }).click();
  assert.equal(
    await page
      .locator("[data-reader-body]")
      .evaluate((e) => getComputedStyle(e).fontSize),
    "17px",
  );
  await page.screenshot({
    path: "auth/runtime/news-reader-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await page.locator("[data-entry-modal]").waitFor({ state: "visible" });
  await page
    .locator("[data-entry-form]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("[data-entry-modal]").waitFor({ state: "hidden" });
  assert.ok(
    (
      await (await context.request.get("/api/workspace/items")).json()
    ).items.some((i) => i.kind === "link"),
  );
  await page.locator("[data-add=event]").click();
  await page.getByLabel("Title / role", { exact: true }).fill("Career webinar");
  await page
    .locator("[data-entry-form]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("[data-entry-modal]").waitFor({ state: "hidden" });
  await page
    .locator("[data-event-list]")
    .getByText("Career webinar", { exact: true })
    .waitFor();
  await context.route("**/api/jobs/article?*", (r) =>
    r.fulfill({
      json: {
        article: {
          id: 1,
          title: "Safe reader",
          url: "https://dev.to/test/article",
          source: "DEV Community",
          author: "Author",
          date: "2026-10-10",
          image: "",
          minutes: 1,
          tags: ["career"],
          body: '<p>Safe article text.</p><script>window.articleInjected=true</script><img src="javascript:alert(1)" onerror="window.articleInjected=true"><a href="javascript:alert(1)">unsafe link</a><iframe src="https://example.com"></iframe>',
        },
      },
    }),
  );
  await page.locator("[data-read-story]").first().click();
  await page
    .getByRole("heading", { name: "Safe reader", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(
        "[data-reader-body] script,[data-reader-body] iframe,[data-reader-body] [onerror]",
      )
      .count(),
    0,
  );
  assert.equal(
    await page.locator('[data-reader-body] a[href^="javascript:"]').count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.articleInjected), undefined);
  await page.getByRole("button", { name: "Back to stories" }).click();
  sessions = 0;
  await page.goto("/desk/calendar");
  await page.locator(".calendar-day").first().waitFor();
  await page.locator("[data-ready=true]").waitFor();
  assert.ok(sessions <= 1, 'At most one session request; server-rendered pages reuse their session');
  assert.equal(
    await page.locator("[data-jobify-user-name]").innerText(),
    "News Reader",
  );
  assert.equal(
    await page
      .locator("[data-jobify-user-name]")
      .evaluate((e) => e.textContent === "Sign in"),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/news");
  await page.locator(".story-card").first().waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "auth/runtime/news-mobile.png",
    fullPage: true,
  });
  await page.locator("[data-read-story]").first().click();
  await page
    .getByRole("heading", { name: "Safe reader", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("[data-news-reader]")
      .evaluate((e) => e.scrollWidth > innerWidth),
    false,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-news-reader]").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: images, search/topic filters, in-page article reader, font controls, saved reading links, event creation, unsafe HTML removal, at most one session request per page, calendar hydration and mobile layout.",
  );
} finally {
  await browser.close();
  execFileSync("C:/xampp/php/php.exe", [php, email, "cleanup"], {
    stdio: "inherit",
  });
}
