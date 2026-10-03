import { test, expect, type Page } from "./fixtures/electron-app";
import { configureRenderer, seedProjectAndSession } from "./helpers/app-state";

async function openLongConversation(page: Page) {
  await configureRenderer(page);
  const messages = Array.from({ length: 70 }, (_, index) => [
    { id: `question-${index}`, role: "user", content: `Question ${index + 1}: explain this part of the project`, timestamp: index * 2 },
    { id: `answer-${index}`, role: "assistant", content: `Answer ${index + 1}.\n\n${"Detailed explanation. ".repeat(60)}`, timestamp: index * 2 + 1 },
  ]).flat();
  const project = await seedProjectAndSession(page, { messages });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Question navigation" });
  await expect(nav.getByRole("button")).toHaveCount(70);
  return { nav, project };
}

test("previews and jumps to historical questions, tracks scrolling, and keeps a long rail usable", async ({ page }, testInfo) => {
  const { nav } = await openLongConversation(page);
  const scroll = page.locator('[data-slot="chat-scroll-container"]');
  const first = nav.locator('[data-question-target="question-0"]');
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-69");
  await nav.evaluate((element) => { element.scrollTop = 0; });
  await first.hover();
  await expect(page.getByRole("tooltip")).toContainText("Question 1: explain this part of the project");
  await first.click();
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-0");
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(80);
  await expect(page.locator('[data-message-id="question-0"]')).toHaveClass(/search-highlight/);

  // Keyboard focus exposes the same preview and Enter follows the same jump path.
  await page.mouse.move(500, 200);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tooltip")).toContainText("Question 2:");
  await page.keyboard.press("Enter");
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-1");
  const middle = nav.locator('[data-question-target="question-35"]');
  await middle.click();
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-35");
  await expect.poll(() => page.locator('[data-message-id="question-35"]').evaluate((element) => {
    const container = element.closest('[data-slot="chat-scroll-container"]')!;
    return Math.round(element.getBoundingClientRect().top - container.getBoundingClientRect().top);
  })).toBe(56);
  await page.mouse.move(500, 200);
  await middle.blur();
  await page.screenshot({ path: testInfo.outputPath("question-navigation.png") });

  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-69");
  await expect(nav.locator('[aria-current="location"]')).toBeInViewport();

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByPlaceholder("Find in chat...").fill("Question 11:");
  await expect(page.locator('[data-message-id="question-10"]')).toHaveClass(/search-highlight/);
  await expect(page.locator('[data-message-id="question-10"]')).toBeInViewport();
  // A rail jump takes precedence even while the search highlight is still active.
  await first.click();
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-0");
});

test("hides navigation and its gutter in narrow chats and restores it when widened", async ({ electronApp, page }, testInfo) => {
  const { nav } = await openLongConversation(page);
  const scroll = page.locator('[data-slot="chat-scroll-container"]');
  await nav.locator('[data-question-target="question-69"]').hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(780, 700));
  await expect.poll(() => scroll.evaluate((element) => element.clientWidth)).toBeLessThan(600);
  await expect(nav).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(scroll).toHaveCSS("padding-inline-start", "0px");
  await page.screenshot({ path: testInfo.outputPath("question-navigation-hidden.png") });

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 700));
  await expect(nav).toBeVisible();
  await expect(scroll).toHaveCSS("padding-inline-start", "28px");
  const last = nav.locator('[data-question-target="question-69"]');
  await last.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const bounds = await page.getByRole("tooltip").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await page.screenshot({ path: testInfo.outputPath("question-preview-narrow.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.locator('[data-slot="chat-scroll-container"]')).toHaveJSProperty("scrollWidth", await page.locator('[data-slot="chat-scroll-container"]').evaluate((element) => element.clientWidth));
});

test("question jumps stay in their own split pane", async ({ electronApp, page }) => {
  const { project } = await openLongConversation(page);
  await page.evaluate(async (projectId) => {
    const original = await window.claude.sessions.load(projectId, "playwright-session");
    if (!original) throw new Error("Missing fixture session");
    await window.claude.sessions.save({ ...original, id: "second-session", title: "Second Session" });
  }, project.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1700, 900));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1700);
  await page.getByRole("button", { name: "Second Session", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Split View" }).click();
  const rails = page.getByRole("navigation", { name: "Question navigation" });
  await expect(rails).toHaveCount(2);
  const scrolls = page.locator('[data-slot="chat-scroll-container"]');
  await expect(scrolls.nth(1).locator("[data-message-id]")).toHaveCount(140);
  await expect.poll(() => scrolls.nth(1).evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ))).toBeLessThanOrEqual(2);
  const otherPosition = await scrolls.nth(1).evaluate((element) => element.scrollTop);
  await rails.nth(0).locator('[data-question-target="question-0"]').click();
  await expect(rails.nth(0).locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-0");
  await expect(scrolls.nth(1)).toHaveJSProperty("scrollTop", otherPosition);
  await expect(rails.nth(1).locator('[aria-current="location"]')).toHaveAttribute("data-question-target", "question-69");

  // Visibility follows each pane's width even when the overall window is wide.
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 900));
  await expect(rails).toHaveCount(0);
  await expect(scrolls.nth(0)).toHaveCSS("padding-inline-start", "0px");
  await expect(scrolls.nth(1)).toHaveCSS("padding-inline-start", "0px");
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1700, 900));
  await expect(rails).toHaveCount(2);
});
