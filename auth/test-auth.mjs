import { chromium } from "../jobfinder/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const email = `auth-test-${Date.now()}@example.invalid`;
const password = "Test-only-password-2026";
const nextPassword = "Updated-only-password-2026";
const phpTest = fileURLToPath(new URL("./test-account.php", import.meta.url));
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({ baseURL: "http://localhost:3000" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("/sign-up");
  await page.locator("[data-auth-form]").waitFor({ state: "visible" });
  await page.getByLabel("Name", { exact: true }).fill("Settings Test");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL("**/job-listing");
  execFileSync("C:/xampp/php/php.exe", [phpTest, email], { stdio: "inherit" });
  await page.locator('[data-jobify-account-link][href="/settings"]').waitFor();
  await page.locator("[data-jobify-account-link]").click();
  await page.waitForURL("**/settings");
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
  await page.waitForURL("**/sign-in");
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
  await page.waitForURL("**/job-listing");
  await page.goto("/sign-in");
  await page.waitForURL("**/job-listing");
  await page.goto("/account");
  await page.waitForURL("**/settings");
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
  await page.waitForURL("**/sign-in");
  await page.goto("/settings");
  await page.waitForURL("**/sign-in");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: signup/login go to jobs, settings require login, profile persists, password update verifies current password, old password rejected, avatar, CSRF/origin, account redirect and mobile layout.",
  );
} finally {
  await browser.close();
  execFileSync("C:/xampp/php/php.exe", [phpTest, email, "cleanup"], {
    stdio: "inherit",
  });
}
