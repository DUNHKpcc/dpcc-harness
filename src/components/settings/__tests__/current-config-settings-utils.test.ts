import { describe, expect, it } from "vitest";
import {
  buildConfigSourcePatch,
  shouldApplyConfigSourceRefresh,
} from "../current-config-settings-utils";

describe("current config settings utilities", () => {
  it("ignores stale config source refreshes from older requests", () => {
    expect(shouldApplyConfigSourceRefresh(2, 2)).toBe(true);
    expect(shouldApplyConfigSourceRefresh(1, 2)).toBe(false);
  });

  it("builds an engine-scoped settings patch for Claude config source changes", () => {
    expect(buildConfigSourcePatch("claude", "local")).toEqual({
      claudeCliConfigSource: "local",
    });
  });

  it("builds an engine-scoped settings patch for Codex config source changes", () => {
    expect(buildConfigSourcePatch("codex", "gateway")).toEqual({
      codexCliConfigSource: "gateway",
    });
  });
});
