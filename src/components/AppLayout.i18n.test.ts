import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

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
});
