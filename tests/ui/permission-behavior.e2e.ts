import { test, expect, type Page } from "./fixtures/electron-app";
import { configureRenderer, seedProjectAndSession } from "./helpers/app-state";

const savedBehavior = (page: Page) => page.evaluate(() => (
  JSON.parse(localStorage.getItem("pcc-agent-settings-store") ?? "{}").state?.acpPermissionBehavior ?? "ask"
));

test("toolbar confirms Allow All, persists only after confirmation, and shares the setting with General", async ({ page, electronApp }) => {
  await configureRenderer(page);
  await seedProjectAndSession(page);
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const trigger = () => page.getByRole("button", { name: /^Agent permissions:/ });
  await expect(trigger()).toHaveAccessibleName("Agent permissions: Ask");
  await trigger().click();
  await expect(page.getByRole("menu").locator("p")).toHaveText([
    "Ask for each permission request", "Approve each request once", "Prefer always-allow approval",
  ]);
  await expect(page.getByRole("menu")).not.toContainText("Applies to all local ACP chats");
  await page.getByRole("menuitem", { name: /^Auto Accept/ }).click();
  await expect.poll(() => savedBehavior(page)).toBe("auto_accept");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger().click();
  await page.getByRole("menuitem", { name: /^Allow All/ }).click();
  const dialog = page.getByRole("dialog", { name: "Enable Allow All?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep current mode" })).toBeFocused();
  expect(await savedBehavior(page)).toBe("auto_accept");
  await dialog.getByRole("button", { name: "Keep current mode" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger()).toBeFocused();
  expect(await savedBehavior(page)).toBe("auto_accept");

  await trigger().click();
  await page.getByRole("menuitem", { name: /^Allow All/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await savedBehavior(page)).toBe("auto_accept");
  await trigger().click();
  await page.getByRole("menuitem", { name: /^Allow All/ }).click();
  await dialog.getByRole("button", { name: "Enable Allow All", exact: true }).click();
  await expect.poll(() => savedBehavior(page)).toBe("allow_all");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(trigger()).toHaveAccessibleName("Agent permissions: Allow All");

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send("menu-bar:open-settings"));
  await page.locator('[data-settings-section="general"]').click();
  const group = page.getByRole("group", { name: "Agent permissions" });
  await expect(group.getByRole("button", { name: /^Allow All/ })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: /^Ask/ }).click();
  await expect.poll(() => savedBehavior(page)).toBe("ask");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await group.getByRole("button", { name: /^Allow All/ }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(group).toBeVisible(); // Escape must not also close Settings.
  await expect(group.getByRole("button", { name: /^Ask/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back Home" }).click();
  await expect(trigger()).toHaveAccessibleName("Agent permissions: Ask");
});

test("onboarding shows short descriptions and only Allow All requires confirmation", async ({ page }, testInfo) => {
  await configureRenderer(page, { welcomeCompleted: false });
  await page.getByRole("button", { name: "Continue without signing in" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  const group = page.getByRole("group", { name: "Agent permissions" });
  await expect(group.locator("p")).toHaveText([
    "Ask for each permission request", "Approve each request once", "Prefer always-allow approval",
  ]);
  await expect(group.getByRole("button", { name: /^Ask/ })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: /^Auto Accept/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await group.getByRole("button", { name: /^Ask/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await group.getByRole("button", { name: /^Allow All/ }).click();
  const dialog = page.getByRole("dialog");
  expect(await savedBehavior(page)).toBe("ask");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(group.getByRole("button", { name: /^Ask/ })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: /^Allow All/ }).click();
  await dialog.getByRole("button", { name: "Enable Allow All", exact: true }).click();
  await expect(group.getByRole("button", { name: /^Allow All/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => savedBehavior(page)).toBe("allow_all");
  await page.screenshot({ path: testInfo.outputPath("permissions-onboarding.png") });
});

test("Chinese dark settings show a concise confirmation only for Allow All in a small window", async ({ page, electronApp }, testInfo) => {
  await configureRenderer(page);
  await page.evaluate(() => {
    const key = "pcc-agent-settings-store";
    const stored = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
    stored.state.language = "zh";
    stored.state.theme = "dark";
    localStorage.setItem(key, JSON.stringify(stored));
    localStorage.setItem("pcc-agent-language", "zh");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(780, 700);
    window?.webContents.send("menu-bar:open-settings");
  });
  await page.locator('[data-settings-section="general"]').click();
  const group = page.getByRole("group", { name: "Agent 权限" });
  await expect(group.locator("p")).toHaveText(["收到权限请求时逐次确认", "自动批准单次请求", "优先使用始终允许"]);
  await group.getByRole("button", { name: /^自动接受/ }).click();
  await expect.poll(() => savedBehavior(page)).toBe("auto_accept");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await group.getByRole("button", { name: /^全部允许/ }).click();
  const dialog = page.getByRole("dialog", { name: "启用“全部允许”？" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.screenshot({ path: testInfo.outputPath("permissions-confirm-zh-dark.png") });
  await dialog.getByRole("button", { name: "启用全部允许", exact: true }).click();
  await expect.poll(() => savedBehavior(page)).toBe("allow_all");
  await group.getByRole("button", { name: /^询问/ }).click();
  await expect.poll(() => savedBehavior(page)).toBe("ask");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
