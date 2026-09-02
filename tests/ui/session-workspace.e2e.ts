import { test, expect } from "./fixtures/electron-app";
import { configureRenderer, seedProjectAndSession } from "./helpers/app-state";

test("shows the dormant Pi model state on a fresh profile", async ({ page }) => {
  await configureRenderer(page);

  const piCache = await page.evaluate(async () => {
    const agents = await window.claude.agents.list();
    const pi = agents.find((agent) => agent.id === "pi-acp");
    return {
      configCount: pi?.cachedConfigOptions?.length ?? 0,
      commandNames: pi?.cachedSlashCommands?.map((command) => command.name) ?? [],
    };
  });
  expect(piCache.configCount).toBe(0);
  expect(piCache.commandNames).toContain("compact");

  await page.locator('[data-sidebar-top-actions="true"]')
    .getByRole("button", { name: "New Chat", exact: true })
    .click();
  await page.locator('[data-slot="model-thinking-trigger"]').click();

  await expect(page.locator('[data-slot="model-options-dormant"]'))
    .toHaveText("Model options load after your first message");
  await expect(page.locator('[data-slot="model-options-unavailable"]')).toHaveCount(0);
});

test("restores the sidebar from the ACP Agents workspace", async ({ page }) => {
  await configureRenderer(page);

  await page.locator('[data-sidebar-acp-agents-entry="true"]').click();
  const workspace = page.locator('[data-sidebar-workspace="acp-agents"]');
  await expect(workspace).toBeVisible();

  await page.locator('[data-sidebar-toggle="true"]').click();
  const restoreButton = page.locator('[data-sidebar-restore="true"]');
  await expect(restoreButton).toBeVisible();
  await expect(workspace.locator('[data-sidebar-workspace-header="true"]')).toContainText("ACP Agents");
  await restoreButton.click();

  await expect(page.locator('[data-sidebar-acp-agents-entry="true"]')).toBeVisible();
  await expect(restoreButton).toHaveCount(0);
  await expect(workspace).toBeVisible();
});

test("restores the sidebar from the Plugins workspace", async ({ page }) => {
  await configureRenderer(page);

  await page.locator('[data-sidebar-plugin-entry="true"]').click();
  const workspace = page.locator('[data-sidebar-workspace="plugins"]');
  await expect(workspace).toBeVisible();

  await page.locator('[data-sidebar-toggle="true"]').click();
  const restoreButton = page.locator('[data-sidebar-restore="true"]');
  await expect(restoreButton).toBeVisible();
  await expect(workspace.locator('[data-sidebar-workspace-header="true"]')).toContainText("Plugins");
  await restoreButton.click();

  await expect(page.locator('[data-sidebar-plugin-entry="true"]')).toBeVisible();
  await expect(restoreButton).toHaveCount(0);
  await expect(workspace).toBeVisible();
});

test("refreshes a dormant Pi model catalog after account authorization without starting Pi", async ({ electronApp, page }) => {
  const oldModel = "pcc-agent-dpcc-claude/model-old";
  const newModel = "pcc-agent-dpcc-claude/model-new";
  const initialConfig = [{
    id: "model",
    name: "Model",
    category: "model",
    type: "select" as const,
    currentValue: oldModel,
    options: [{ value: oldModel, name: `${oldModel} (DPCC API (Claude))` }],
  }, {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    type: "select" as const,
    currentValue: "high",
    options: [
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  }];

  await configureRenderer(page);
  await page.evaluate(async (configOptions) => {
    await window.claude.agents.updateCachedConfig("pi-acp", configOptions);
  }, initialConfig);
  await electronApp.evaluate(({ ipcMain }) => {
    const counters = { refreshCalls: 0, startCalls: 0 };
    (globalThis as typeof globalThis & {
      __harnssPiModelRefreshCounters?: typeof counters;
    }).__harnssPiModelRefreshCounters = counters;

    ipcMain.removeHandler("agents:refresh-pi-model-cache");
    ipcMain.handle("agents:refresh-pi-model-cache", () => {
      counters.refreshCalls += 1;
      return { ok: true, modelCount: 2, updated: false };
    });
    ipcMain.removeHandler("acp:start");
    ipcMain.handle("acp:start", () => {
      counters.startCalls += 1;
      throw new Error("Dormant model refresh must not start Pi");
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor();

  await page.locator('[data-sidebar-top-actions="true"]')
    .getByRole("button", { name: "New Chat", exact: true })
    .click();
  const modelTrigger = page.locator('[data-slot="model-thinking-trigger"]');
  await expect(modelTrigger).toContainText("model-old");
  await expect(modelTrigger).toContainText(/high/i);
  await modelTrigger.click();
  await expect(page.locator('[data-slot="model-option-list"]')
    .getByText("model-old", { exact: true })).toBeVisible();
  await expect(page.getByText("model-new", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.evaluate(async (refreshedConfig) => {
    await window.claude.agents.updateCachedConfig("pi-acp", refreshedConfig);
  }, [{
    ...initialConfig[0],
    currentValue: newModel,
    options: [
      { value: oldModel, name: `${oldModel} (DPCC API (Claude))` },
      { value: newModel, name: `${newModel} (DPCC API (Claude))` },
    ],
  }, {
    ...initialConfig[1],
    currentValue: "medium",
  }]);
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("account-auth:changed", {
      status: "connected",
      issuer: "https://account.example.test",
      clientId: "pcc-agent-desktop",
      deviceName: "Playwright",
      account: null,
      expiresAt: Date.now() + 60_000,
      scopes: [],
      legacyManual: false,
    });
  });

  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & {
      __harnssPiModelRefreshCounters?: { refreshCalls: number; startCalls: number };
    }
  ).__harnssPiModelRefreshCounters)).toEqual({ refreshCalls: 1, startCalls: 0 });
  await expect(modelTrigger).toContainText("model-old");
  await expect(modelTrigger).toContainText(/high/i);
  await modelTrigger.click();
  await expect(page.locator('[data-slot="model-option-list"]')
    .getByText("model-new", { exact: true })).toBeVisible();
  expect(await electronApp.evaluate(() => (
    globalThis as typeof globalThis & {
      __harnssPiModelRefreshCounters?: { refreshCalls: number; startCalls: number };
    }
  ).__harnssPiModelRefreshCounters?.startCalls)).toBe(0);
});

test("opens and renames a persisted session through the sidebar", async ({ page }) => {
  await configureRenderer(page);
  const project = await seedProjectAndSession(page);

  await expect(page.getByText(project.name, { exact: true })).toBeVisible();
  const sessionButton = page.getByRole("button", { name: "Playwright Session", exact: true });
  await sessionButton.click();
  await expect(page.getByText("Inspect the workspace fixture", { exact: true })).toBeVisible();
  await expect(page.getByText("The workspace fixture is ready.", { exact: true })).toBeVisible();

  await sessionButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameInput = page.locator('[data-session-item-id="playwright-session"] input');
  await renameInput.fill("Renamed by Playwright");
  await renameInput.press("Enter");
  await expect(page.getByRole("button", { name: "Renamed by Playwright", exact: true })).toBeVisible();

  await expect.poll(async () => page.evaluate(async ({ projectId }) => {
    const bridge = (window as typeof window & {
      claude: { sessions: { load: (projectId: string, sessionId: string) => Promise<{ title?: string } | null> } };
    }).claude;
    return (await bridge.sessions.load(projectId, "playwright-session"))?.title;
  }, { projectId: project.id })).toBe("Renamed by Playwright");
});

test("opens cached Pi context details without starting a dormant Pi session", async ({ electronApp, page }) => {
  await configureRenderer(page);
  await electronApp.evaluate(({ ipcMain }) => {
    const counters = { startCalls: 0, reviveCalls: 0 };
    (globalThis as typeof globalThis & {
      __harnssPiContextCacheCounters?: typeof counters;
    }).__harnssPiContextCacheCounters = counters;

    ipcMain.removeHandler("acp:start");
    ipcMain.handle("acp:start", () => {
      counters.startCalls += 1;
      throw new Error("Opening cached context must not start Pi");
    });
    ipcMain.removeHandler("acp:revive-session");
    ipcMain.handle("acp:revive-session", () => {
      counters.reviveCalls += 1;
      throw new Error("Opening cached context must not revive Pi");
    });
  });
  const capturedAt = Date.now();
  const contextTimeline = Array.from({ length: 48 }, (_, index) => ({
    id: `context-entry-${index}`,
    kind: index === 0
      ? "user" as const
      : index === 1
        ? "tool" as const
        : index === 2
          ? "custom" as const
          : "assistant" as const,
    label: index === 1 ? "Tool: read" : index === 2 ? "model_change" : null,
    timestamp: capturedAt - 1_000 + index * 10,
    tokenEstimate: 48 + index,
    characterCount: 192 + index,
    excerpt: index === 0
      ? "Inspect the current context details."
      : index === 1
        ? null
        : `Timeline fixture entry ${index}.`,
    excerptTruncated: false,
  }));
  await seedProjectAndSession(page, {
    piContextSnapshots: [
      {
        version: 1,
        id: "pi-context-before-compact",
        capturedAt: capturedAt - 1_000,
        phase: "settled",
        source: "pi-extension",
        model: "pcc-agent/gpt-5.6",
        usedTokens: 48_000,
        contextWindow: 128_000,
        percent: 37.5,
        breakdown: {
          systemPromptTokens: 4_000,
          toolTokens: 3_000,
          conversationTokens: 41_000,
          reservedOutputTokens: 8_000,
          freeTokens: 72_000,
        },
        details: {
          systemPrompt: {
            characterCount: 16_000,
            tokenEstimate: 4_000,
          },
          tools: [
            {
              name: "read",
              description: "Read a tracked project file.",
              tokenEstimate: 96,
            },
          ],
          totalTools: 1,
          omittedTools: 0,
          timeline: contextTimeline,
          totalEntries: contextTimeline.length,
          omittedEntries: 0,
        },
      },
      {
        version: 1,
        id: "pi-context-after-compact",
        capturedAt,
        phase: "compacted",
        source: "pi-extension",
        model: "pcc-agent/gpt-5.6",
        usedTokens: null,
        contextWindow: 128_000,
        percent: null,
        breakdown: {
          systemPromptTokens: 4_000,
          toolTokens: 3_000,
          conversationTokens: 0,
          reservedOutputTokens: 8_000,
          freeTokens: 128_000,
        },
        compaction: {
          reason: "manual",
          tokensBefore: 120_000,
          summary: "Kept the active implementation decisions and next steps.",
        },
      },
    ],
  });

  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const contextEntry = page.locator("[data-context-gauge]");
  await expect(contextEntry).toBeVisible();
  const [entryBox, composerBox] = await Promise.all([
    contextEntry.boundingBox(),
    page.locator("[data-chat-composer]").boundingBox(),
  ]);
  expect(entryBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect((composerBox!.x + composerBox!.width) - (entryBox!.x + entryBox!.width)).toBeLessThanOrEqual(64);
  await contextEntry.click();

  const inspector = page.locator("[data-context-inspector]");
  await expect(inspector).toBeVisible();
  const [inspectorBox, viewport] = await Promise.all([
    inspector.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox!.width / viewport.width).toBeGreaterThan(0.69);
  expect(inspectorBox!.width / viewport.width).toBeLessThan(0.71);
  expect(inspectorBox!.height / viewport.height).toBeGreaterThan(0.69);
  expect(inspectorBox!.height / viewport.height).toBeLessThan(0.71);
  await expect(inspector.locator("[data-context-cache-status]")).toHaveText("Cached");
  await expect(inspector.locator("[data-context-snapshot-index]")).toHaveText("Snapshot 2 of 2");
  await expect(inspector).toContainText("Kept the active implementation decisions and next steps.");
  await expect(inspector.getByRole("button", { name: "Compact context" })).toHaveCount(0);

  await inspector.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(inspector.locator("[data-context-detail-system]")).toContainText("4.0k");
  await expect(inspector.locator("[data-context-detail-tools]")).toContainText("Read a tracked project file.");

  await inspector.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(inspector.locator("[data-context-timeline-axis]")).toBeVisible();
  await expect(inspector.locator('[data-context-timeline-track="user"]')).toBeVisible();
  await expect(inspector.locator('[data-context-timeline-track="assistant"]')).toBeVisible();
  await expect(inspector.locator('[data-context-timeline-track="tool"]')).toBeVisible();
  await expect(inspector.locator('[data-context-timeline-track="system"]')).toBeVisible();
  const userMarker = inspector.locator('[data-context-timeline-marker][data-context-timeline-category="user"]');
  await userMarker.click();
  await expect(userMarker).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.locator("[data-context-timeline-detail]")).toHaveAttribute(
    "data-context-timeline-entry-id",
    "context-entry-0",
  );
  await expect(inspector.locator("[data-context-timeline-detail]")).toContainText("Inspect the current context details.");
  const toolMarker = inspector.locator('[data-context-timeline-marker][data-context-timeline-category="tool"]');
  await expect(toolMarker).toHaveAttribute("aria-label", /Tool: read/);
  await toolMarker.click();
  await expect(inspector.locator("[data-context-timeline-detail]")).toHaveAttribute(
    "data-context-timeline-entry-id",
    "context-entry-1",
  );
  await expect(inspector.locator("[data-context-timeline-detail]")).toContainText("Tool: read");

  await inspector.locator("[data-context-previous]").click();
  await expect(inspector.locator("[data-context-snapshot-index]")).toHaveText("Snapshot 1 of 2");
  await expect(inspector.locator("[data-context-next]")).toBeEnabled();
  await inspector.getByRole("tab", { name: "Overview", exact: true }).click();
  const usageBar = inspector.locator("[data-context-usage-bar]");
  await expect(usageBar).toHaveAttribute("aria-valuenow", "48000");
  await expect(usageBar.locator("[data-context-usage-used]")).toHaveAttribute("style", /width: 37.5%/);
  await expect(usageBar.locator("[data-context-usage-remaining]")).toHaveAttribute("style", /width: 62.5%/);
  await expect(inspector.locator("[data-context-usage-labels]")).toContainText("Used 48.0k");
  await expect(inspector.locator("[data-context-usage-labels]")).toContainText("Remaining 80.0k");

  await inspector.locator("[data-context-next]").click();
  await expect(inspector.locator("[data-context-snapshot-index]")).toHaveText("Snapshot 2 of 2");
  await expect(usageBar).toHaveAttribute("data-context-usage-unavailable", "true");
  await expect(usageBar).not.toHaveAttribute("aria-valuenow");
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & {
      __harnssPiContextCacheCounters?: { startCalls: number; reviveCalls: number };
    }
  ).__harnssPiContextCacheCounters)).toEqual({ startCalls: 0, reviveCalls: 0 });
});

test("shows the cache-empty state for a dormant Pi session", async ({ page }) => {
  await configureRenderer(page);
  await seedProjectAndSession(page);

  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const contextEntry = page.locator("[data-context-gauge]");
  await expect(contextEntry).toBeVisible();
  await contextEntry.click();

  const inspector = page.locator("[data-context-inspector]");
  await expect(inspector).toBeVisible();
  await expect(inspector.locator("[data-context-cache-status]")).toHaveText("Cached");
  await expect(inspector.locator("[data-context-inspector-empty]")).toContainText("No context snapshots yet");
  await expect(inspector).toContainText("Pi has not saved a context snapshot for this session.");
});

test("shows compact model names and brand icons across model surfaces", async ({ electronApp, page }) => {
  const qualifiedModel = "pcc-agent-dpcc-codex/gpt-5.3-codex-spark";
  await configureRenderer(page);
  await page.evaluate(async (model) => {
    await window.claude.agents.updateCachedConfig("pi-acp", [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: [
        { value: model, name: `${model} (DPCC API (Codex))` },
        { value: "xai/grok-4.6", name: "Grok 4.6" },
        { value: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
      ],
    }]);
  }, qualifiedModel);
  await electronApp.evaluate(({ ipcMain }) => {
    const model = "pcc-agent-dpcc-codex/gpt-5.3-codex-spark";
    const emptyEngine = {
      source: "default" as const,
      providerName: null,
      baseUrl: null,
      maskedToken: null,
      model: null,
    };
    const emptyModels = { source: "default" as const, models: [], error: null };
    ipcMain.removeHandler("cc-config:effective");
    ipcMain.handle("cc-config:effective", () => ({
      claude: { ...emptyEngine },
      codex: { ...emptyEngine },
      pi: { ...emptyEngine, model },
    }));
    ipcMain.removeHandler("cc-config:models");
    ipcMain.handle("cc-config:models", () => ({
      claude: { ...emptyModels },
      codex: { ...emptyModels },
      pi: {
        source: "default",
        models: [model, "xai/grok-4.6", "anthropic/claude-haiku-4-5"],
        error: null,
      },
    }));
  });
  const project = await seedProjectAndSession(page, { model: qualifiedModel });

  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  const modelTrigger = page.locator('[data-slot="model-thinking-trigger"]');
  const triggerIcon = modelTrigger.locator('[data-slot="model-icon"][data-model-brand="openai"]');
  await expect(triggerIcon).toBeVisible();
  await expect.poll(() => triggerIcon.evaluate((element) => getComputedStyle(element).maskImage))
    .not.toBe("none");
  await modelTrigger.click();
  const modelOptions = page.locator('[data-slot="model-option-list"]');
  for (const brand of ["openai", "grok", "claude"]) {
    const icon = modelOptions.locator(`[data-slot="model-icon"][data-model-brand="${brand}"]`);
    await expect(icon).toBeVisible();
    await expect.poll(() => icon.evaluate((element) => getComputedStyle(element).maskImage))
      .not.toBe("none");
  }
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Session Details", exact: true }).click();

  const details = page.locator('[data-slot="session-details-popover"]');
  await expect(details.getByText("gpt-5.3-codex-spark", { exact: true })).toBeVisible();
  await expect(details.locator('[data-slot="model-icon"][data-model-brand="openai"]')).toBeVisible();
  await expect(page.getByText(qualifiedModel, { exact: true })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async ({ projectId }) => {
    const persisted = await window.claude.sessions.load(projectId, "playwright-session");
    return persisted?.model;
  }, { projectId: project.id })).toBe(qualifiedModel);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu-bar:open-settings");
  });
  await page.locator('[data-settings-section="current-config"]').click();
  const configModels = page.locator('[data-slot="current-config-model-list"]');
  await expect(configModels.getByText("gpt-5.3-codex-spark", { exact: true })).toBeVisible();
  for (const brand of ["openai", "grok", "claude"]) {
    await expect(configModels.locator(`[data-slot="model-icon"][data-model-brand="${brand}"]`))
      .toBeVisible();
  }
});

test("previews project files, resizes the list, and restores its width", async ({ electronApp, page }) => {
  await configureRenderer(page);
  await seedProjectAndSession(page);
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();

  await page.getByRole("button", { name: "Toggle Panels" }).click();
  await page.getByRole("menuitem", { name: "Project Files" }).click();

  const layout = page.locator('[data-file-browser-layout="project-files"]');
  const preview = layout.locator("[data-file-browser-preview]");
  const list = layout.locator("[data-file-browser-list]");
  await expect(layout).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(list).toBeVisible();

  await page.getByPlaceholder("Search files…").fill("workspace.ts");
  await page.getByText("workspace.ts", { exact: true }).click();
  await expect(preview.getByText("workspace.ts", { exact: true })).toBeVisible();
  await expect(preview.locator(".monaco-editor")).toBeVisible();
  await expect(preview.locator(".view-lines")).toContainText("export const ready = true;");
  expect(await layout.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(526);
  expect(await preview.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(239);
  expect(await list.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(279);
  const initialWidths = await layout.evaluate((element) => ({
    layout: element.getBoundingClientRect().width,
    preview: element.querySelector<HTMLElement>("[data-file-browser-preview]")?.getBoundingClientRect().width ?? 0,
    list: element.querySelector<HTMLElement>("[data-file-browser-list]")?.getBoundingClientRect().width ?? 0,
    handle: element.querySelector<HTMLElement>("[data-file-browser-resize-handle]")?.getBoundingClientRect().width ?? 0,
  }));
  expect(initialWidths.preview + initialWidths.list + initialWidths.handle)
    .toBeLessThanOrEqual(initialWidths.layout + 1);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1600, 900);
  });
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1500);
  await expect.poll(async () => page.locator(".chat-island").evaluate((element) =>
    element.getBoundingClientRect().width)).toBeGreaterThan(650);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  const layoutWidthBefore = await layout.evaluate((element) => element.getBoundingClientRect().width);
  const outerHandle = page.locator("[data-main-tool-area-resize-handle]");
  const outerBox = await outerHandle.boundingBox();
  if (!outerBox) throw new Error("Main tool area resize handle is not visible.");
  await page.mouse.move(outerBox.x + outerBox.width / 2, outerBox.y + outerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(outerBox.x - 180, outerBox.y + outerBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => layout.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(layoutWidthBefore + 140);

  const before = await list.evaluate((element) => element.getBoundingClientRect().width);
  const handle = page.locator("[data-file-browser-resize-handle]");
  const box = await handle.boundingBox();
  if (!box) throw new Error("File browser resize handle is not visible.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const resized = await list.evaluate((element) => element.getBoundingClientRect().width);
  expect(resized).toBeGreaterThan(before + 60);
  expect(await preview.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(240);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor();
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(layout).toBeVisible();
  await expect.poll(async () => list.evaluate((element) => element.getBoundingClientRect().width))
    .toBeCloseTo(resized, 0);

  await page.getByRole("button", { name: "Toggle Panels" }).click();
  await page.getByRole("menuitem", { name: "Project Files" }).click();
  await expect(layout).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor();
  await page.getByRole("button", { name: "Playwright Session", exact: true }).click();
  await expect(layout).toBeHidden();
  await page.getByRole("button", { name: "Toggle Panels" }).click();
  await page.getByRole("menuitem", { name: "Project Files" }).click();
  await expect(layout).toBeVisible();
  await expect.poll(async () => list.evaluate((element) => element.getBoundingClientRect().width))
    .toBeCloseTo(resized, 0);
});
