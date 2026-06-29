import { describe, expect, it } from "vitest";
import {
  mergeFileWatchEvents,
  shouldFetchProjectFiles,
  shouldIgnoreFileWatchPath,
} from "../project-files-utils";

describe("mergeFileWatchEvents", () => {
  it("coalesces changed paths and remembers structural changes", () => {
    const summary = mergeFileWatchEvents([
      { eventType: "change", path: "src/App.tsx" },
      { eventType: "rename", path: "src/new-file.ts" },
      { eventType: "change", path: "src/App.tsx" },
    ]);

    expect(summary).toEqual({
      paths: ["src/App.tsx", "src/new-file.ts"],
      hasStructuralChange: true,
    });
  });
});

describe("shouldFetchProjectFiles", () => {
  it("skips content-only watcher refreshes because the tree shape is unchanged", () => {
    expect(shouldFetchProjectFiles({
      reason: "content-change",
      now: 1_000,
      lastFetchAt: 0,
      staleMs: 30_000,
    })).toBe(false);
  });

  it("throttles focus refreshes until the cache is stale", () => {
    expect(shouldFetchProjectFiles({
      reason: "focus",
      now: 10_000,
      lastFetchAt: 0,
      staleMs: 30_000,
    })).toBe(false);

    expect(shouldFetchProjectFiles({
      reason: "focus",
      now: 31_000,
      lastFetchAt: 0,
      staleMs: 30_000,
    })).toBe(true);
  });

  it("always fetches for initial, manual, and structural refreshes", () => {
    for (const reason of ["initial", "manual", "structure-change"] as const) {
      expect(shouldFetchProjectFiles({
        reason,
        now: 10_000,
        lastFetchAt: 9_999,
        staleMs: 30_000,
      })).toBe(true);
    }
  });
});

describe("shouldIgnoreFileWatchPath", () => {
  it("does not ignore ordinary dotfiles or dot-directories used by projects", () => {
    expect(shouldIgnoreFileWatchPath(".env")).toBe(false);
    expect(shouldIgnoreFileWatchPath(".github/workflows/ci.yml")).toBe(false);
    expect(shouldIgnoreFileWatchPath(".vscode/settings.json")).toBe(false);
  });

  it("ignores VCS internals and dependency folders", () => {
    expect(shouldIgnoreFileWatchPath(".git/index")).toBe(true);
    expect(shouldIgnoreFileWatchPath(".hg/store")).toBe(true);
    expect(shouldIgnoreFileWatchPath(".svn/wc.db")).toBe(true);
    expect(shouldIgnoreFileWatchPath("node_modules/react/index.js")).toBe(true);
  });
});
