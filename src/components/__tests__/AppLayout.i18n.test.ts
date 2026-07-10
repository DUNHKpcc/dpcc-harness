import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("AppLayout i18n", () => {
  it("keeps split-width toast messages in locale files", () => {
    const appLayout = fs.readFileSync(path.join(repoRoot, "src/components/AppLayout.tsx"), "utf8");
    const enWorkspace = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/i18n/locales/en/workspace.json"), "utf8"));
    const zhWorkspace = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/i18n/locales/zh/workspace.json"), "utf8"));

    expect(appLayout).not.toContain("Widen the window to show the Codex split pane when Claude delegates.");
    expect(appLayout).not.toContain("Widen the window to add another split pane.");
    expect(enWorkspace.split.codexDelegationNeedsWidth).toBeTypeOf("string");
    expect(enWorkspace.split.addPaneNeedsWidth).toBeTypeOf("string");
    expect(zhWorkspace.split.codexDelegationNeedsWidth).toBeTypeOf("string");
    expect(zhWorkspace.split.addPaneNeedsWidth).toBeTypeOf("string");
  });

  it("renders settings instead of the workspace shell", () => {
    const appLayout = fs.readFileSync(path.join(repoRoot, "src/components/AppLayout.tsx"), "utf8");

    expect(appLayout).toContain('{showSettings ? (\n        <div className="relative z-10 flex min-w-0 flex-1">');
    expect(appLayout).not.toContain('className="fixed inset-0 z-50 flex bg-background"');
    expect(appLayout).not.toContain('className={showSettings ? "hidden" : "flex min-h-0 flex-1 flex-col"}');
  });

  it("does not render an empty titlebar above settings navigation", () => {
    const settingsView = fs.readFileSync(path.join(repoRoot, "src/components/SettingsView.tsx"), "utf8");

    expect(settingsView).not.toContain("drag-region flex h-[3.25rem] shrink-0 items-center");
  });

  it("keeps macOS window controls from overlapping the settings nav", () => {
    const settingsView = fs.readFileSync(path.join(repoRoot, "src/components/SettingsView.tsx"), "utf8");

    expect(settingsView).toContain('isMac ? "pt-[3.25rem]" : "pt-2"');
  });

  it("keeps the settings navigation draggable without swallowing button clicks", () => {
    const settingsView = fs.readFileSync(path.join(repoRoot, "src/components/SettingsView.tsx"), "utf8");

    expect(settingsView).toContain("drag-region flex flex-1 flex-col");
    expect(settingsView).toContain('className="no-drag mb-1 flex w-full');
    expect(settingsView).toContain('className={`no-drag flex w-full');
  });

  it("adds shared top spacing to every settings option page", () => {
    const settingsView = fs.readFileSync(path.join(repoRoot, "src/components/SettingsView.tsx"), "utf8");

    expect(settingsView).toContain(
      'const settingsContentTopPaddingClass = isMac ? "pt-[3.25rem]" : "pt-2"',
    );
    expect(settingsView).toContain(
      "drag-region flex min-w-0 flex-1 justify-center overflow-hidden",
    );
    expect(settingsView).toContain(
      'className="no-drag flex min-h-0 w-full max-w-3xl flex-1 flex-col"',
    );
  });

  it("rebinds workspace width observation when the content node is replaced", () => {
    const appLayout = fs.readFileSync(path.join(repoRoot, "src/components/AppLayout.tsx"), "utf8");

    expect(appLayout).toContain("const handleContentContainerRef = useCallback(");
    expect(appLayout).toContain("availableSplitWidthObserverRef.current?.disconnect()");
    expect(appLayout).toContain("ref={handleContentContainerRef}");
  });
});
