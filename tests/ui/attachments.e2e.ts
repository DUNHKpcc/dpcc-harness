import { test, expect, type Locator, type Page } from "./fixtures/electron-app";
import { configureRenderer } from "./helpers/app-state";
import fs from "node:fs";
import path from "node:path";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
  "base64",
);

async function openComposer(page: Page) {
  await configureRenderer(page);
  await page.locator('[data-sidebar-top-actions="true"]')
    .getByRole("button", { name: "New Chat", exact: true }).click();
  const composer = page.locator("[data-chat-composer]");
  await expect(composer.locator('input[type="file"]')).toBeAttached();
  return composer;
}

async function dragDiskPaths(page: Page, target: Locator, paths: string[]) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Composer not visible for native file drop");
  const session = await page.context().newCDPSession(page);
  const drag = { items: [], files: paths, dragOperationsMask: 1 };
  const location = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  for (const type of ["dragEnter", "dragOver", "drop"] as const) {
    await session.send("Input.dispatchDragEvent", { type, ...location, data: drag });
  }
  await session.detach();
}

test("calculates a dropped folder's size through the real Electron bridge", async ({ page, uiProfile }) => {
  const folder = path.join(uiProfile.root, "Dragged Folder");
  fs.mkdirSync(path.join(folder, "nested"), { recursive: true });
  fs.writeFileSync(path.join(folder, "first.txt"), "12345");
  fs.writeFileSync(path.join(folder, "nested", "second.txt"), "1234567");

  const composer = await openComposer(page);
  await dragDiskPaths(page, composer, [folder]);

  const tile = composer.locator('[data-slot="file-attachment-tile"]');
  await expect(tile).toHaveCount(1);
  await expect(tile).toHaveAttribute("title", folder);
  await expect(tile).toContainText("Folder · 12 B");
  await expect(tile.locator("svg")).toHaveClass(/text-amber-500/);
  await composer.getByRole("button", { name: "Remove Dragged Folder" }).click();
  await expect(tile).toHaveCount(0);
});

test("keeps selected images and files aligned and scrollable in a narrow composer", async ({ electronApp, page, uiProfile }) => {
  const image = path.join(uiProfile.root, "preview.png");
  fs.writeFileSync(image, TINY_PNG);
  const docs = ["document.docx", "table.csv", "report.pdf", ...Array.from({ length: 7 }, (_, i) => `notes-${i}.txt`)]
    .map((name) => {
      const file = path.join(uiProfile.root, name);
      fs.writeFileSync(file, `Fixture for ${name}`);
      return file;
    });
  const composer = await openComposer(page);
  await composer.locator('input[type="file"]').setInputFiles([image, ...docs]);
  const strip = composer.locator('[data-slot="composer-attachment-strip"]');
  const imageTile = strip.locator('[data-slot="image-attachment-thumbnail"]');
  const fileTile = strip.locator('[data-slot="file-attachment-tile"]');
  await expect(imageTile).toHaveCount(1);
  await expect(fileTile).toHaveCount(docs.length);
  await expect(fileTile.filter({ hasText: "DOCX" }).locator("svg")).toHaveClass(/text-blue-600/);
  await expect(fileTile.filter({ hasText: "CSV" }).locator("svg")).toHaveClass(/text-emerald-600/);

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(780, 700));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(800);
  const layout = await strip.evaluate((element) => {
    const tiles = [...element.querySelectorAll<HTMLElement>(
      '[data-slot="image-attachment-thumbnail"], [data-slot="file-attachment-tile"]',
    )];
    return {
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      sizes: tiles.map((tile) => ({ width: tile.getBoundingClientRect().width, height: tile.getBoundingClientRect().height })),
      tops: tiles.map((tile) => tile.getBoundingClientRect().top),
    };
  });
  expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
  expect(layout.sizes).toEqual(Array.from({ length: docs.length + 1 }, () => ({ width: 64, height: 64 })));
  expect(Math.max(...layout.tops) - Math.min(...layout.tops)).toBeLessThan(1);
  await strip.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await composer.getByRole("button", { name: "Remove document.docx" }).click();
  await expect(fileTile).toHaveCount(docs.length - 1);
  await composer.locator('[data-slot="image-attachment-remove"]').click();
  await expect(imageTile).toHaveCount(0);
});

test("sends multiple image and file attachments into one smaller, scrollable message strip", async ({ electronApp, page, uiProfile }) => {
  const images = ["sent-a.png", "sent-b.png"].map((name) => {
    const file = path.join(uiProfile.root, name);
    fs.writeFileSync(file, TINY_PNG);
    return file;
  });
  const docs = ["sent.docx", "sheet.csv", "report.pdf", "notes.txt"].map((name) => {
    const file = path.join(uiProfile.root, name);
    fs.writeFileSync(file, `Fixture for ${name}`);
    return file;
  });
  const composer = await openComposer(page);
  await composer.locator('input[type="file"]').setInputFiles([...images, ...docs]);
  await expect(composer.locator('[data-slot="file-attachment-tile"]')).toHaveCount(docs.length);
  await expect(composer.locator('[data-slot="image-attachment-thumbnail"]')).toHaveCount(images.length);
  await composer.getByRole("textbox").fill("Check these attachments");
  await composer.getByRole("button", { name: "Send" }).click();

  const message = page.locator('[data-message-id]:has([data-slot="message-attachment-strip"])').last();
  await expect(message).toBeVisible();
  const strip = message.locator('[data-slot="message-attachment-strip"]');
  await expect(strip.locator('[data-slot="message-image-thumbnail"]')).toHaveCount(images.length);
  await expect(strip.locator('[data-slot="file-attachment-tile"]')).toHaveCount(docs.length);
  await expect(message.locator('[data-slot="user-message-bubble"]')).toContainText("Check these attachments");
  await expect(message).not.toContainText("Attached local file references:");
  await expect(composer.locator('[data-slot="composer-attachment-strip"]')).toHaveCount(0);

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(780, 700));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(800);
  const layout = await strip.evaluate((element) => {
    const tiles = [...element.querySelectorAll<HTMLElement>(
      '[data-slot="message-image-thumbnail"], [data-slot="file-attachment-tile"]',
    )];
    return {
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      sizes: tiles.map((tile) => ({ width: tile.getBoundingClientRect().width, height: tile.getBoundingClientRect().height })),
      tops: tiles.map((tile) => tile.getBoundingClientRect().top),
    };
  });
  expect(layout.sizes).toEqual(Array.from({ length: images.length + docs.length }, () => ({ width: 80, height: 80 })));
  expect(Math.max(...layout.tops) - Math.min(...layout.tops)).toBeLessThan(1);
  expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
  await strip.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await strip.locator('[data-slot="message-image-thumbnail"]').first().click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "sent-a.png" })).toBeVisible();
});
