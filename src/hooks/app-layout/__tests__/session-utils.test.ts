import { describe, expect, it } from "vitest";
import { CHAT_MODULE_PROJECT_ID } from "@/lib/session/chat-module";
import { buildSessionOptions, resolveComposerClearProjectId } from "../session-utils";
import type { ClaudeEffort, EngineId } from "@/types";

const getModel = (_engine: EngineId) => "claude-opus-4-8";
const noEffort = (_model: string | undefined): ClaudeEffort | undefined => undefined;

describe("buildSessionOptions claudeCodexBridgeEnabled", () => {
  it("carries the bridge flag for Claude sessions", () => {
    const options = buildSessionOptions("claude", getModel, "default", false, false, noEffort, null, true);
    expect(options.claudeCodexBridgeEnabled).toBe(true);
  });

  it("never enables the bridge for non-Claude engines", () => {
    const codex = buildSessionOptions("codex", getModel, "default", false, false, noEffort, null, true);
    expect(codex.claudeCodexBridgeEnabled).toBe(false);
    const acp = buildSessionOptions("acp", getModel, "default", false, false, noEffort, null, true);
    expect(acp.claudeCodexBridgeEnabled).toBe(false);
  });

  it("defaults to disabled when the flag is omitted", () => {
    const options = buildSessionOptions("claude", getModel, "default", false, false, noEffort, null);
    expect(options.claudeCodexBridgeEnabled).toBe(false);
  });
});

describe("resolveComposerClearProjectId", () => {
  it("keeps clear/new-chat actions inside the active project context", () => {
    expect(resolveComposerClearProjectId("project-1")).toBe("project-1");
  });

  it("keeps clear/new-chat actions in Chat when Chat is already active", () => {
    expect(resolveComposerClearProjectId(CHAT_MODULE_PROJECT_ID)).toBe(CHAT_MODULE_PROJECT_ID);
  });

  it("falls back to Chat only when no project context is active", () => {
    expect(resolveComposerClearProjectId(null)).toBe(CHAT_MODULE_PROJECT_ID);
    expect(resolveComposerClearProjectId(undefined)).toBe(CHAT_MODULE_PROJECT_ID);
  });
});
