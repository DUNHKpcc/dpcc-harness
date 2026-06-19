import { describe, expect, it } from "vitest";
import { buildSessionOptions } from "./session-utils";
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
