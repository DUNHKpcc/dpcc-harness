import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/types";
import { getSyncedPlanMode } from "../useAppOrchestrator";
import { upsertCodexSessionInfo } from "../useCodex";

describe("Codex plan mode sync helpers", () => {
  it("prefers live permission mode over the persisted session flag", () => {
    expect(getSyncedPlanMode(true, "bypassPermissions")).toBe(false);
    expect(getSyncedPlanMode(false, "plan")).toBe(true);
  });

  it("falls back to the session flag when no live permission mode exists", () => {
    expect(getSyncedPlanMode(true, undefined)).toBe(true);
    expect(getSyncedPlanMode(false, "")).toBe(false);
  });

  it("creates minimal Codex session info when only session id and model are known", () => {
    expect(
      upsertCodexSessionInfo(null, "codex-session", "gpt-5.4", "plan"),
    ).toEqual({
      sessionId: "codex-session",
      model: "gpt-5.4",
      cwd: "",
      tools: [],
      version: "",
      permissionMode: "plan",
    });
  });

  it("preserves existing Codex session metadata while updating permission mode", () => {
    const existing: SessionInfo = {
      sessionId: "codex-session",
      model: "gpt-5.4",
      cwd: "/repo",
      tools: ["exec"],
      version: "1.2.3",
      permissionMode: "plan",
      agentName: "Codex",
    };

    expect(
      upsertCodexSessionInfo(
        existing,
        "ignored-session",
        "ignored-model",
        "bypassPermissions",
      ),
    ).toEqual({
      ...existing,
      permissionMode: "bypassPermissions",
    });
  });
});
