import { test, expect } from "./fixtures/electron-app";
import {
  configureRenderer,
  seedLocalMcpServers,
  seedLocalSkills,
  seedUserPiExtension,
} from "./helpers/app-state";

test("keeps the plugin workspace responsive and scrolls installed skills internally", async ({
  electronApp,
  page,
  uiProfile,
}) => {
  seedLocalSkills(uiProfile.home);
  seedLocalMcpServers(uiProfile.home);
  seedUserPiExtension(uiProfile.home);
  await configureRenderer(page);
  await page.locator('[data-sidebar-plugin-entry="true"]').click();

  const pluginCenter = page.locator('[data-plugin-center="true"]');
  await expect(pluginCenter).toBeVisible();
  await page.locator('[data-plugin-tab="pi-packages"]').click();
  await expect(page.getByRole("heading", { name: "Pi Packages", exact: true })).toBeVisible();
  await expect(page.getByText("local-fixture.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("Local Pi", { exact: true })).toBeVisible();

  await page.locator('[data-plugin-tab="skills"]').click();
  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();

  const installed = page.locator('[data-installed-list="skills"]');
  await expect(installed.locator(":scope > div")).toHaveCount(8);
  const installedSize = await installed.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(installedSize.clientHeight).toBeLessThanOrEqual(156);
  expect(installedSize.scrollHeight).toBeGreaterThan(installedSize.clientHeight);
  await expect(page.getByText("catalog-skill", { exact: true })).toBeVisible();

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(1000);
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.locator('[data-plugin-tab="mcp"]').click();
  await expect(page.getByRole("heading", { name: "MCP", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search Official MCP Registry")).toBeVisible();
  const installedMcp = page.locator('[data-installed-list="mcp"]');
  await expect(installedMcp.locator(":scope > div")).toHaveCount(3);
  await expect(installedMcp.getByText("local-fixture", { exact: true })).toBeVisible();
  await expect(installedMcp.getByText("claude-fixture", { exact: true })).toBeVisible();
  await expect(installedMcp.getByText("codex-fixture", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture MCP", { exact: true })).toBeVisible();
});
