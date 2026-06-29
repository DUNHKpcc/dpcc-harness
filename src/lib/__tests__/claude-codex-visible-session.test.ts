import { describe, expect, it } from "vitest";
import {
  buildDelegatedCodexSession,
  buildCodexDelegationCompletion,
  extractCodexDelegationFinalText,
  resolveCodexDelegationRuntime,
} from "../claude-codex-visible-session";
import type { ChatSession, Project, UIMessage } from "@/types";

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

describe("resolveCodexDelegationRuntime", () => {
  const projects: Project[] = [
    { id: "project-active", name: "Active", path: "/repo/active", createdAt: 1 },
    { id: "project-requested", name: "Requested", path: "/repo/requested", createdAt: 1 },
  ];
  const sessions: ChatSession[] = [
    {
      id: "claude-active",
      projectId: "project-active",
      title: "Active Claude",
      createdAt: 1,
      totalCost: 0,
      engine: "claude",
      isActive: true,
    },
    {
      id: "claude-owner",
      projectId: "project-requested",
      title: "Owner Claude",
      createdAt: 1,
      totalCost: 0,
      engine: "claude",
      isActive: false,
    },
  ];

  it("uses the request's Claude session id instead of the active session", () => {
    expect(resolveCodexDelegationRuntime({
      request: { id: "delegation-1", prompt: "Do work", claudeSessionId: "claude-owner" },
      activeSessionId: "claude-active",
      activeSessionProjectId: "project-active",
      activeProjectId: "project-active",
      activeSpaceProjectId: null,
      sessions,
      projects,
    })).toMatchObject({
      claudeSessionId: "claude-owner",
      projectId: "project-requested",
    });
  });

  it("honors cwd by selecting the matching project", () => {
    expect(resolveCodexDelegationRuntime({
      request: { id: "delegation-1", prompt: "Do work", cwd: "/repo/requested/src" },
      activeSessionId: "claude-active",
      activeSessionProjectId: "project-active",
      activeProjectId: "project-active",
      activeSpaceProjectId: null,
      sessions,
      projects,
    })).toMatchObject({
      projectId: "project-requested",
      cwd: "/repo/requested/src",
    });
  });

  it("does not treat an active ACP session as a Claude parent", () => {
    expect(resolveCodexDelegationRuntime({
      request: { id: "delegation-1", prompt: "Do work" },
      activeSessionId: "acp-active",
      activeSessionProjectId: "project-active",
      activeProjectId: "project-active",
      activeSpaceProjectId: null,
      sessions: [
        ...sessions,
        {
          id: "acp-active",
          projectId: "project-active",
          title: "ACP",
          createdAt: 1,
          totalCost: 0,
          engine: "acp",
          isActive: true,
        },
      ],
      projects,
    }).claudeSessionId).toBeNull();
  });
});

describe("buildCodexDelegationCompletion", () => {
  const messages: UIMessage[] = [
    { id: "a1", role: "assistant", content: "Done", timestamp: 1 },
  ];

  it("returns success only for completed Codex turns", () => {
    expect(buildCodexDelegationCompletion({
      bridgeRequestId: "delegation-1",
      codexSessionId: "codex-1",
      status: "completed",
      messages,
    })).toMatchObject({
      ok: true,
      content: "Done",
      codexSessionId: "codex-1",
    });
  });

  it("returns an error when the Codex turn fails", () => {
    expect(buildCodexDelegationCompletion({
      bridgeRequestId: "delegation-1",
      codexSessionId: "codex-1",
      status: "failed",
      errorMessage: "boom",
      messages,
    })).toMatchObject({
      ok: false,
      content: "",
      error: "boom",
    });
  });

  it("returns an error when the Codex turn is interrupted", () => {
    expect(buildCodexDelegationCompletion({
      bridgeRequestId: "delegation-1",
      codexSessionId: "codex-1",
      status: "interrupted",
      messages,
    })).toMatchObject({
      ok: false,
      content: "",
      error: "Codex delegation was interrupted.",
    });
  });
});
