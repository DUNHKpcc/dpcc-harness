import { test, expect, launchUiElectron } from "./fixtures/electron-app";
import type { Page } from "@playwright/test";
import { configureRenderer, seedProjectAndSession } from "./helpers/app-state";
import fs from "node:fs";
import path from "node:path";

const messageRow = (page: Page, id: string) => page.locator(`[data-message-id="${id}"]`);
const deletionDialog = (page: Page) => page.getByRole("dialog", { name: /Delete this (?:message|entire reply)\?/ });

async function openSession(page: Page) {
  await configureRenderer(page);
  const project = await seedProjectAndSession(page);
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(messageRow(page, "playwright-assistant")).toBeVisible();
  return project;
}

async function deleteRow(page: Page, id: string) {
  const row = messageRow(page, id);
  await row.hover();
  await row.getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(deletionDialog(page)).toContainText("The model may still retain it in its context");
  await deletionDialog(page).getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(row).toHaveCount(0);
}

async function storedIds(page: Page, projectId: string, sessionId = "playwright-session") {
  return page.evaluate(async ({ projectId, sessionId }) => (
    (await window.claude.sessions.load(projectId, sessionId))?.messages.map((message) => message.id)
  ), { projectId, sessionId });
}

test("reuses hover/focus and copy interaction, cancels safely and deletes only the selected message", async ({ page, electronApp }, testInfo) => {
  const project = await openSession(page);
  const row = messageRow(page, "playwright-user");
  const action = row.getByRole("button", { name: "Delete message", exact: true });
  const actions = action.locator("..");
  await page.mouse.move(5, 5);
  await expect(actions).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(action).toHaveCSS("width", "20px");
  await row.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe("Inspect the workspace fixture");
  await page.mouse.move(5, 5);
  await action.focus();
  await expect(actions).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(deletionDialog(page)).toBeVisible();
  await deletionDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
  await expect.poll(() => storedIds(page, project.id)).toEqual(["playwright-user", "playwright-assistant"]);
  await action.click();
  await page.keyboard.press("Escape");
  await expect(deletionDialog(page)).toHaveCount(0);
  await expect(row).toBeVisible();
  await row.hover();
  await page.screenshot({ path: testInfo.outputPath("message-actions.png") });
  await deleteRow(page, "playwright-user");
  await expect(messageRow(page, "playwright-assistant")).toBeVisible();
  await expect.poll(() => storedIds(page, project.id)).toEqual(["playwright-assistant"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(messageRow(page, "playwright-user")).toHaveCount(0);
  await expect(messageRow(page, "playwright-assistant")).toBeVisible();
});

test("deletes a whole reply from its thinking-only bubble without deleting attachment files", async ({ page, uiProfile }) => {
  await configureRenderer(page);
  const filePath = path.join(uiProfile.root, "original.pdf");
  fs.writeFileSync(filePath, "original attachment");
  const project = await seedProjectAndSession(page, { messages: [
    { id: "file-only", role: "user", content: `Attached local file references:\n- ${filePath}`, timestamp: 1 },
    { id: "image-only", role: "user", content: "", timestamp: 2, images: [{ id: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", mediaType: "image/png" }] },
    { id: "thinking-only", role: "assistant", content: "", thinking: "Thoughts for this answer", thinkingComplete: true, timestamp: 3 },
    { id: "tool-history", role: "tool_call", content: "", toolName: "Read", toolInput: { file_path: filePath }, toolUseId: "read-file", toolResult: { content: "original attachment" }, timestamp: 4 },
    { id: "following-answer", role: "assistant", content: "Following answer remains", timestamp: 5 },
  ] });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  for (const id of ["thinking-only", "file-only", "image-only"]) await deleteRow(page, id);
  expect(fs.readFileSync(filePath, "utf8")).toBe("original attachment");
  await expect(messageRow(page, "following-answer")).toHaveCount(0);
  await expect(messageRow(page, "tool-history")).toHaveCount(0);
  await expect(page.getByText(/Worked for /)).toHaveCount(0);
  await expect.poll(() => storedIds(page, project.id)).toEqual([]);
});

// One reply contains multiple assistant records, grouped tools, nested execution
// steps, separate tool results, and the derived timing/change-summary UI.
const replyRecords = [
  { id: "reply-thinking", role: "assistant", content: "", thinking: "Whole reply reasoning", thinkingComplete: true, timestamp: 1_000 },
  { id: "reply-progress", role: "assistant", content: "Inspecting the reply files", timestamp: 2_000 },
  { id: "reply-read", role: "tool_call", content: "", toolName: "Read", toolInput: { file_path: "/tmp/whole-reply.txt" }, toolResult: { content: "Reply source" }, timestamp: 3_000 },
  { id: "reply-read-again", role: "tool_call", content: "", toolName: "Read", toolInput: { file_path: "/tmp/whole-reply-other.txt" }, toolResult: { content: "Other reply source" }, timestamp: 4_000 },
  { id: "reply-result", role: "tool_result", content: "Reply tool result", timestamp: 5_000 },
  { id: "reply-edit", role: "tool_call", content: "", toolName: "Edit", toolInput: { file_path: "/tmp/whole-reply.txt", old_string: "before", new_string: "after" }, toolResult: { content: "Edited successfully" }, timestamp: 6_000 },
  { id: "reply-task", role: "tool_call", content: "", toolName: "Task", toolInput: { description: "Nested reply execution", prompt: "Inspect reply" }, subagentSteps: [{ toolName: "Read", toolInput: { file_path: "/tmp/nested-reply.txt" }, toolUseId: "nested-read", toolResult: { content: "Nested result" } }], subagentStatus: "completed", timestamp: 7_000 },
  { id: "reply-system", role: "system", content: "Reply execution status", timestamp: 8_000 },
  { id: "playwright-assistant", role: "assistant", content: "Whole reply final answer", timestamp: 35_000 },
];
const questionRecord = { id: "playwright-user", role: "user", content: "Whole reply question", timestamp: 500 };

test("deletes the entire reply with thinking, grouped tools, results, execution and Worked for timing, keeping neighboring turns after reload", async ({ page }) => {
  await configureRenderer(page);
  const project = await seedProjectAndSession(page, { messages: [
    { id: "prior-question", role: "user", content: "Prior question", timestamp: 100 },
    { id: "prior-answer", role: "assistant", content: "Prior answer", timestamp: 200 },
    questionRecord, ...replyRecords,
    { id: "next-question", role: "user", content: "Next question", timestamp: 36_000 },
    { id: "next-answer", role: "assistant", content: "Next answer", timestamp: 37_000 },
  ] });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(page.getByText("Worked for 34s", { exact: true })).toBeVisible();
  await expect(page.getByText("Inspecting the reply files", { exact: true })).toBeVisible();
  const changeSummary = page.getByRole("button", { name: /1 file changed.*whole-reply\.txt/ });
  await expect(changeSummary).toBeVisible();
  const row = messageRow(page, "playwright-assistant");
  await row.hover();
  await row.getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(deletionDialog(page)).toContainText("including thinking, tool calls and results");
  await deletionDialog(page).getByRole("button", { name: "Delete message", exact: true }).click();
  for (const record of replyRecords) await expect(messageRow(page, record.id)).toHaveCount(0);
  await expect(page.getByText("Worked for 34s", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reply execution status", { exact: true })).toHaveCount(0);
  await expect(changeSummary).toHaveCount(0);
  const remaining = ["prior-question", "prior-answer", "playwright-user", "next-question", "next-answer"];
  await expect.poll(() => storedIds(page, project.id)).toEqual(remaining);
  for (const id of remaining) await expect(messageRow(page, id)).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  for (const record of replyRecords) await expect(messageRow(page, record.id)).toHaveCount(0);
  expect(await storedIds(page, project.id)).toEqual(remaining);
});

test("deleting a question then its reply after reload never deletes the previous reply", async ({ page }) => {
  await configureRenderer(page);
  const project = await seedProjectAndSession(page, { messages: [
    { id: "prior-question", role: "user", content: "Prior question", timestamp: 100 },
    { id: "prior-answer", role: "assistant", content: "Prior answer", timestamp: 200 },
    questionRecord, ...replyRecords,
  ] });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await deleteRow(page, "playwright-user");
  await expect.poll(() => storedIds(page, project.id)).toEqual(["prior-question", "prior-answer", ...replyRecords.map((message) => message.id)]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await deleteRow(page, "playwright-assistant");
  await expect(messageRow(page, "prior-answer")).toBeVisible();
  await expect.poll(() => storedIds(page, project.id)).toEqual(["prior-question", "prior-answer"]);
});

test("secondary-pane deletion stays isolated and survives closing split view", async ({ page, electronApp }) => {
  const project = await openSession(page);
  await page.evaluate(async ({ projectId, questionRecord, replyRecords }) => {
    const original = await window.claude.sessions.load(projectId, "playwright-session");
    if (!original) throw new Error("Missing session");
    await window.claude.sessions.save({ ...original, id: "second-session", title: "Second Session", messages: [questionRecord, ...replyRecords] });
  }, { projectId: project.id, questionRecord, replyRecords });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1700, 900));
  await page.getByRole("button", { name: "Second Session", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Split View" }).click();
  const chats = page.locator('[data-slot="chat-scroll-container"]');
  await expect(chats).toHaveCount(2);
  const secondAnswer = chats.nth(1).locator('[data-message-id="playwright-assistant"]');
  await secondAnswer.hover();
  await secondAnswer.getByRole("button", { name: "Delete message", exact: true }).click();
  await deletionDialog(page).getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(secondAnswer).toHaveCount(0);
  for (const record of replyRecords) await expect(chats.nth(1).locator(`[data-message-id="${record.id}"]`)).toHaveCount(0);
  await expect(chats.nth(1).getByText(/Worked for /)).toHaveCount(0);
  await expect(chats.nth(0).locator('[data-message-id="playwright-assistant"]')).toBeVisible();
  await expect.poll(() => storedIds(page, project.id, "second-session")).toEqual(["playwright-user"]);
  await expect.poll(() => storedIds(page, project.id)).toEqual(["playwright-user", "playwright-assistant"]);
  await page.locator(".chat-island").last().locator(".chat-titlebar-bg button:has(svg.lucide-x)").click();
  await page.getByRole("button", { name: "Second Session", exact: true }).click();
  await expect(messageRow(page, "playwright-user")).toBeVisible();
  await expect(messageRow(page, "playwright-assistant")).toHaveCount(0);
});

test("deleting the final message persists across a full Electron restart", async ({ uiProfile, catalogServerUrl }) => {
  let app = await launchUiElectron(uiProfile, catalogServerUrl);
  try {
    let page = await app.firstWindow();
    const project = await openSession(page);
    await deleteRow(page, "playwright-assistant");
    await deleteRow(page, "playwright-user");
    await expect.poll(() => storedIds(page, project.id)).toEqual([]);
    await app.close();
    app = await launchUiElectron(uiProfile, catalogServerUrl);
    page = await app.firstWindow();
    await page.waitForSelector("#root");
    await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
    await expect(page.locator("[data-message-id]")).toHaveCount(0);
    expect(await storedIds(page, project.id)).toEqual([]);
    await expect(page.locator("[data-chat-composer]")).toBeVisible();
  } finally {
    await app.close();
  }
});

for (const engine of ["claude", "codex"] as const) {
  test(`manages historical ${engine} messages without enabling its retired runtime`, async ({ page }) => {
    const project = await openSession(page);
    await page.evaluate(async ({ projectId, engine }) => {
      const original = await window.claude.sessions.load(projectId, "playwright-session");
      if (!original) throw new Error("Missing session");
      await window.claude.sessions.save({ ...original, engine, agentId: undefined, codexThreadId: "original-thread", codexRolloutPath: "/original/rollout.jsonl", totalCost: 9 });
    }, { projectId: project.id, engine });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
    await deleteRow(page, "playwright-assistant");
    const saved = await page.evaluate(async (projectId) => window.claude.sessions.load(projectId, "playwright-session"), project.id);
    expect(saved).toMatchObject({ engine, totalCost: 9, codexThreadId: "original-thread", codexRolloutPath: "/original/rollout.jsonl" });
    expect(saved?.messages.map((message) => message.id)).toEqual(["playwright-user"]);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  });
}

async function openLiveFixture(page: Page, root: string) {
  const project = await openSession(page);
  const releasePath = path.join(root, "release-turn");
  const logPath = path.join(root, "prompt-log");
  await page.evaluate(async ({ projectId, binary, fixture, releasePath, logPath }) => {
    await window.claude.agents.save({ id: "message-delete-fixture", name: "Message deletion fixture", engine: "acp", binary, args: [fixture, releasePath, logPath] });
    const original = await window.claude.sessions.load(projectId, "playwright-session");
    if (!original) throw new Error("Missing session");
    await window.claude.sessions.save({ ...original, agentId: "message-delete-fixture" });
  }, { projectId: project.id, binary: process.execPath, fixture: path.resolve("tests/ui/fixtures/message-deletion-agent.mjs"), releasePath, logPath });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  return { releasePath, logPath };
}

test("blocks sent-message deletion during a live turn but removes queued messages without sending them", async ({ page, uiProfile }) => {
  const { releasePath, logPath } = await openLiveFixture(page, uiProfile.root);
  const composer = page.locator('[data-chat-composer] [role="textbox"]');
  await composer.fill("hold the fixture turn");
  await composer.press("Enter");
  await expect(page.getByText("Fixture streamed answer", { exact: true })).toBeVisible();
  const sentAction = messageRow(page, "playwright-user").getByRole("button", { name: "Delete message", exact: true });
  await expect(sentAction).toBeDisabled();
  await composer.fill("queued message must not reach the agent");
  await composer.press("Enter");
  const queued = page.locator("[data-message-id]").filter({ hasText: "queued message must not reach the agent" });
  await expect(queued).toBeVisible();
  await queued.hover();
  await queued.getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(queued).toHaveCount(0);
  await expect(deletionDialog(page)).toHaveCount(0);
  fs.writeFileSync(releasePath, "finish");
  await expect(sentAction).toBeEnabled();
  expect(fs.readFileSync(logPath, "utf8")).not.toContain("queued message must not reach the agent");
});

test("blocks deletion while a tool is awaiting permission", async ({ page, uiProfile }) => {
  await openLiveFixture(page, uiProfile.root);
  const composer = page.locator('[data-chat-composer] [role="textbox"]');
  await composer.fill("permission required");
  await composer.press("Enter");
  await expect(page.getByText("Use tool: Fixture permission", { exact: true })).toBeVisible();
  await expect(messageRow(page, "playwright-user").getByRole("button", { name: "Delete message", exact: true })).toBeDisabled();
});


test("restores the entire reply and reports failure when the disk write fails", async ({ page, electronApp }) => {
  await configureRenderer(page);
  const project = await seedProjectAndSession(page, { messages: [questionRecord, ...replyRecords] });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("sessions:save");
    ipcMain.handle("sessions:save", () => ({ error: "Fixture disk full" }));
  });
  const row = messageRow(page, "playwright-assistant");
  await row.hover();
  await row.getByRole("button", { name: "Delete message", exact: true }).click();
  await deletionDialog(page).getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(page.getByText("Could not save the deletion. The message has been restored.", { exact: true })).toBeVisible();
  await expect(row).toBeVisible();
  await expect(page.getByText("Worked for 34s", { exact: true })).toBeVisible();
  await expect(messageRow(page, "reply-progress")).toBeVisible();
  expect(await storedIds(page, project.id)).toEqual(["playwright-user", ...replyRecords.map((message) => message.id)]);
});


test("deleting the first question keeps the long-chat scroll position and updates navigation", async ({ page }) => {
  await configureRenderer(page);
  const messages = Array.from({ length: 40 }, (_, index) => [
    { id: `question-${index}`, role: "user", content: `Question ${index + 1}`, timestamp: index * 2 + 1 },
    { id: `answer-${index}`, role: "assistant", content: `Answer ${index + 1}`, timestamp: index * 2 + 2 },
  ]).flat();
  await seedProjectAndSession(page, { messages });
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Question navigation" });
  await nav.locator('[data-question-target="question-0"]').click();
  const scroll = page.locator('[data-slot="chat-scroll-container"]');
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(80);
  await deleteRow(page, "question-0");
  await expect(nav.locator('[data-question-target]')).toHaveCount(39);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(80);
  await expect(messageRow(page, "answer-0")).toBeVisible();
});
