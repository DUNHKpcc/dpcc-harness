import { test, expect } from "./fixtures/electron-app";
import { configureRenderer } from "./helpers/app-state";

test("completes the first-run wizard and persists the choices", async ({ page }) => {
  await configureRenderer(page, { welcomeCompleted: false });

  const wizard = page.locator('[data-package-smoke="welcome-wizard"]');
  await expect(wizard).toBeVisible();
  await page.getByRole("button", { name: "Continue without signing in" }).click();

  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByRole("button", { name: /Auto Accept/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Ready to go" })).toBeVisible();
  await expect(page.getByText("Auto Accept", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start building" }).click();

  await expect(wizard).toBeHidden();
  await expect(page.locator('[data-sidebar-top-actions="true"]')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("pcc-agent-welcome-completed"))).toBe("true");
});
