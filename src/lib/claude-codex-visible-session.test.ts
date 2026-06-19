import { describe, expect, it } from "vitest";
import {
  buildDelegatedCodexSession,
  extractCodexDelegationFinalText,
} from "./claude-codex-visible-session";

describe("buildDelegatedCodexSession", () => {
  it("creates a Codex chat session linked to the Claude delegation", () => {
    const session = buildDelegatedCodexSession({
      id: "codex-1",
      projectId: "project-1",
      model: "gpt-5.4",
      delegatedFromSessionId: "claude-1",
      now: 1000,
    });

    expect(session).toMatchObject({
      id: "codex-1",
      projectId: "project-1",
      engine: "codex",
      agentId: "codex",
      isActive: false,
      title: "Codex delegated task",
      model: "gpt-5.4",
      delegatedFromSessionId: "claude-1",
    });
  });
});

describe("extractCodexDelegationFinalText", () => {
  it("returns the latest assistant message content", () => {
    expect(extractCodexDelegationFinalText([
      { id: "u1", role: "user", content: "Do work", timestamp: 1 },
      { id: "a1", role: "assistant", content: "First", timestamp: 2 },
      { id: "a2", role: "assistant", content: "Final result", timestamp: 3 },
    ])).toBe("Final result");
  });

  it("returns a fallback when no assistant text exists", () => {
    expect(extractCodexDelegationFinalText([])).toBe("Codex completed without a final assistant message.");
  });
});
