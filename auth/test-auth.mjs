import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const email = `auth-test-${Date.now()}@example.invalid`;
const password = "Test-only-password-2026";
const nextPassword = "Updated-only-password-2026";
const phpTest = fileURLToPath(new URL("./test-account.php", import.meta.url));
const { loadEnv } =
  await import("../jobfinder/node_modules/vite/dist/node/index.js");
const environment = loadEnv(
  "development",
  fileURLToPath(new URL("../jobfinder/preview/", import.meta.url)),
  "",
);
const cloud =
  (process.env.JOBLINK_BACKEND || environment.JOBLINK_BACKEND) === "supabase";
async function inspectAccount(cleanup = false) {
  if (!cloud) {
    execFileSync(
      "C:/xampp/php/php.exe",
      [phpTest, email, ...(cleanup ? ["cleanup"] : [])],
      { stdio: "inherit" },
    );
    return;
  }
  for (const [key, value] of Object.entries(environment))
    process.env[key] ??= value;
  const { db, query } = await import("../jobfinder/preview/server/core.mjs");
  if (cleanup) {
    const user = await query(
      db().from("users").select("id").eq("email", email).maybeSingle(),
    );
    if (user) {
      await query(
        db().from("joblink_sessions").delete().eq("user_id", user.id),
      );
      await query(db().from("users").delete().eq("id", user.id));
    }
    return;
  }
  const user = await query(
    db().from("users").select("*").eq("email", email).single(),
  );
  const { default: bcrypt } =
    await import("../jobfinder/preview/node_modules/bcryptjs/index.js");
  assert.equal(await bcrypt.compare(password, user.password_hash), true);
  assert.equal(user.email_verified, false);
}
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({ baseURL: "http://localhost:3000" });
const page = await context.newPage();
page.setDefaultNavigationTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("[data-auth-form]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-ai-open]").isVisible(), false);
  await page.getByLabel("Name", { exact: true }).fill("Settings Test");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL("**/job-listing", { waitUntil: "domcontentloaded" });
  await inspectAccount();
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.locator('[data-jobify-account-link][href="/settings"]').waitFor();
  await page.locator("[data-jobify-account-link]").click();
  await page.waitForURL("**/settings", { waitUntil: "domcontentloaded" });
  await page.locator("[data-content]").waitFor({ state: "visible" });
  assert.equal(
    await page.getByLabel("Email address", { exact: true }).inputValue(),
    email,
  );
  assert.equal(
    await page
      .getByLabel("Email address", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  assert.equal(
    await page.locator("[data-avatar-fallback]").first().textContent(),
    "ST",
  );
  const session = await (await context.request.get("/api/auth/session")).json();
  assert.equal(
    (
      await context.request.post("/api/auth/profile", {
        data: { name: "Forbidden" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await context.request.post("/api/auth/profile", {
        data: { name: "Forbidden" },
        headers: {
          "X-CSRF-Token": session.csrf,
          Origin: "https://untrusted.example",
        },
      })
    ).status(),
    403,
  );
  await page.getByLabel("Display name").fill("Updated Settings");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Profile saved." })
    .waitFor({ state: "visible" });
  await page.reload();
  await page.locator("[data-content]").waitFor({ state: "visible" });
  assert.equal(
    await page.getByLabel("Display name").inputValue(),
    "Updated Settings",
  );
  await page
    .getByLabel("Current password", { exact: true })
    .fill("incorrect-password");
  await page.getByLabel("New password", { exact: true }).fill(nextPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(nextPassword);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Current password is incorrect." })
    .waitFor({ state: "visible" });
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Password updated." })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(/\/sign-in(?:\?|$)/, { waitUntil: "domcontentloaded" });
  await page.locator("[data-auth-form]").waitFor({ state: "visible" });
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Email or password is incorrect." })
    .waitFor({ state: "visible" });
  await page.getByLabel("Password", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/settings", { waitUntil: "domcontentloaded" });
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/job-listing", { waitUntil: "domcontentloaded" });
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/job-listing", { waitUntil: "domcontentloaded" });
  for (const path of [
    "/",
    "/news",
    "/applications",
    "/desk/taskboard",
    "/desk/calendar",
    "/desk/links",
    "/desk/sheet",
  ]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-jobify-account-link][href="/settings"]')
      .waitFor({ state: "attached" });
    assert.equal(
      (await (await page.request.get("/api/auth/session")).json()).user.email,
      email,
    );
  }
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/settings", { waitUntil: "domcontentloaded" });
  await page.locator("[data-content]").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "auth/runtime/settings-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(/\/sign-in(?:\?|$)/, { waitUntil: "domcontentloaded" });
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/sign-in(?:\?|$)/, { waitUntil: "domcontentloaded" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: signup/login go to jobs, settings require login, profile persists, password update verifies current password, old password rejected, avatar, CSRF/origin, account redirect and mobile layout.",
  );
} finally {
  await browser.close();
  await inspectAccount(true);
}
