import { test, expect } from "./fixtures/electron-app";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { configureRenderer, seedProjectAndSession } from "./helpers/app-state";
import { CHAT_COMPOSER_FADE_PX } from "../../src/lib/chat/composer-fade";
import fs from "node:fs";
import path from "node:path";

async function openConversation(page: Page, theme: "light" | "dark" = "light") {
  await configureRenderer(page);
  const messages = Array.from({ length: 40 }, (_, index) => [
    { id: `fade-user-${index}`, role: "user", content: `OVERLAP SENTINEL ${index}: 你好！有什么可以帮你的吗？`, timestamp: index * 2 + 1 },
    { id: `fade-answer-${index}`, role: "assistant", content: `Answer ${index}.\n\n${"Scroll this content behind the floating composer. ".repeat(8)}`, timestamp: index * 2 + 2 },
  ]).flat();
  const project = await seedProjectAndSession(page, { messages });
  await page.evaluate(async (theme) => {
    window.localStorage.setItem("pcc-agent-theme", theme);
    const settings = JSON.parse(window.localStorage.getItem("pcc-agent-settings-store") ?? "{}");
    window.localStorage.setItem("pcc-agent-settings-store", JSON.stringify({ ...settings, state: { ...settings.state, theme } }));
    const spaces = await window.claude.spaces.list();
    await window.claude.spaces.save(spaces.map((space) => ({ ...space, color: { ...space.color, opacity: 0.2 } })));
    await window.claude.agents.updateCachedConfig("pi-acp", [{
      id: "model", name: "Model", category: "model", type: "select",
      currentValue: "fixture/model", options: [{ value: "fixture/model", name: "Fixture model" }],
    }]);
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(page.locator('[data-slot="chat-scroll-container"] [data-message-id]')).toHaveCount(80);
  await page.evaluate(() => document.fonts.ready);
  return project;
}

function composerFor(scroll: Locator) {
  return scroll.locator("..").locator("[data-chat-composer]");
}

async function expectBoundary(scroll: Locator) {
  const composer = composerFor(scroll);
  await expect.poll(async () => {
    const height = Math.ceil((await composer.boundingBox())?.height ?? 0);
    const clip = await scroll.evaluate((element) => getComputedStyle(element).clipPath);
    return height > 0 && clip === `inset(0px 0px ${height}px)`;
  }).toBe(true);
  const height = Math.ceil((await composer.boundingBox())!.height);
  await expect.poll(() => scroll.locator(":scope > div").first().evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)))
    .toBeGreaterThan(height + CHAT_COMPOSER_FADE_PX);
  await expect(scroll).not.toHaveCSS("mask-image", "none");
}

async function expectProtectedFooter(page: Page, scroll: Locator, testInfo: TestInfo, label: string) {
  await expectBoundary(scroll);
  const composer = composerFor(scroll);
  const meta = composer.locator('[data-slot="composer-meta-row"]');
  // Split-pane projection animations can still be settling when the DOM is ready.
  await expect.poll(() => meta.evaluate(async (element) => {
    const before = element.getBoundingClientRect();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = element.getBoundingClientRect();
    return before.x === after.x && before.y === after.y && before.width === after.width;
  })).toBe(true);
  const footer = await meta.boundingBox();
  if (!footer) throw new Error("Missing composer metadata row");
  // Compare transcript bleed, not hover/focus paint of foreground buttons.
  const screenshotStyle = '[data-slot="composer-meta-row"] button { background: transparent !important; box-shadow: none !important; outline: none !important; }';
  await composer.locator('[role="textbox"]').blur();
  await page.mouse.move(5, 5);
  const before = await page.screenshot({
    clip: footer, animations: "disabled", caret: "hide", style: screenshotStyle,
    path: testInfo.outputPath(`${label}-footer-before.png`),
  });

  const row = scroll.locator('[data-message-id="fade-user-10"]');
  await scroll.dispatchEvent("wheel", { deltaY: -1 });
  await scroll.evaluate((element, footerTop) => {
    const row = element.querySelector<HTMLElement>('[data-message-id="fade-user-10"]');
    if (!row) throw new Error("Missing overlap sentinel");
    element.scrollTop += row.getBoundingClientRect().top - footerTop;
  }, footer.y);
  await expect.poll(async () => Math.abs(((await row.boundingBox())?.y ?? 0) - footer.y)).toBeLessThanOrEqual(1);
  const after = await page.screenshot({
    clip: footer, animations: "disabled", caret: "hide", style: screenshotStyle,
    path: testInfo.outputPath(`${label}-footer.png`),
  });
  expect(after.equals(before), "scrolled messages must not alter pixels behind model/permission controls").toBe(true);
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest("[data-message-id]") === null
  ), { x: footer.x + 8, y: footer.y + 8 })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${label}-composer.png`), animations: "disabled" });
}

test("single-chat footer stays free of message text at minimum space opacity", async ({ page }, testInfo) => {
  await openConversation(page);
  const scroll = page.locator('[data-slot="chat-scroll-container"]');
  await expectBoundary(scroll);
  const composer = composerFor(scroll);
  const lastAction = scroll.locator('[data-message-id="fade-answer-39"]').getByRole("button", { name: "Delete message", exact: true });
  const actionBounds = await lastAction.boundingBox();
  const composerBounds = await composer.boundingBox();
  expect(actionBounds!.y + actionBounds!.height).toBeLessThan(composerBounds!.y - CHAT_COMPOSER_FADE_PX);
  await expectProtectedFooter(page, scroll, testInfo, "single");
});

test("each split pane measures its own composer and protects its footer independently", async ({ page, electronApp }, testInfo) => {
  const project = await openConversation(page);
  await page.evaluate(async (projectId) => {
    const original = await window.claude.sessions.load(projectId, "playwright-session");
    if (!original) throw new Error("Missing session");
    await window.claude.sessions.save({ ...original, id: "second-session", title: "Second Session" });
  }, project.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1700, 900));
  await page.getByRole("button", { name: "Second Session", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Split View" }).click();
  const scrolls = page.locator('[data-slot="chat-scroll-container"]');
  await expect(scrolls).toHaveCount(2);
  await expect(scrolls.nth(1).locator("[data-message-id]")).toHaveCount(80);
  await expectBoundary(scrolls.nth(0));
  await expectBoundary(scrolls.nth(1));
  const firstPosition = await scrolls.nth(0).evaluate((element) => element.scrollTop);
  await expectProtectedFooter(page, scrolls.nth(1), testInfo, "split");
  await expect(scrolls.nth(0)).toHaveJSProperty("scrollTop", firstPosition);
});

test("protection follows multiline input, attachments and window resize in dark theme", async ({ page, electronApp, uiProfile }, testInfo) => {
  await openConversation(page, "dark");
  const scroll = page.locator('[data-slot="chat-scroll-container"]');
  const composer = composerFor(scroll);
  await expectBoundary(scroll);
  const initialHeight = (await composer.boundingBox())!.height;
  await composer.locator('[role="textbox"]').fill(Array.from({ length: 10 }, (_, index) => `Draft line ${index}`).join("\n"));
  await expect.poll(async () => (await composer.boundingBox())!.height).toBeGreaterThan(initialHeight);
  await expectBoundary(scroll);
  const file = path.join(uiProfile.root, "fade-attachment.txt");
  fs.writeFileSync(file, "Attachment enlarges the floating composer");
  const multilineHeight = (await composer.boundingBox())!.height;
  await composer.locator('input[type="file"]').setInputFiles(file);
  await expect(composer.locator('[data-slot="file-attachment-tile"]')).toBeVisible();
  await expect.poll(async () => (await composer.boundingBox())!.height).toBeGreaterThan(multilineHeight);
  await expectBoundary(scroll);
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(840, 760));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(840);
  await expectProtectedFooter(page, scroll, testInfo, "expanded-dark");
});
