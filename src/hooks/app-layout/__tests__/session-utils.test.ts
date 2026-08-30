import { describe, expect, it } from "vitest";
import { CHAT_MODULE_PROJECT_ID } from "@/lib/session/chat-module";
import { buildSessionOptions, resolveComposerClearProjectId } from "../session-utils";
import { BUILTIN_PI_AGENT, type EngineId } from "@/types";

const getModel = (_engine: EngineId) => "claude-opus-4-8";

describe("buildSessionOptions Pi identity", () => {
  it("normalizes every new session request to the built-in Pi runtime", () => {
    for (const engine of ["claude", "codex", "acp"] as const) {
      const options = buildSessionOptions(engine, getModel, null);
      expect(options).toMatchObject({
        engine: "acp",
        agentId: "pi-acp",
        permissionMode: "default",
        planMode: false,
      });
    }
  });

  it("preserves a selected custom ACP agent while keeping the ACP protocol", () => {
    const options = buildSessionOptions(
      "acp",
      getModel,
      { id: "custom-agent", name: "Custom", engine: "acp" } as never,
    );
    expect(options).toMatchObject({ engine: "acp", agentId: "custom-agent" });
  });

  it("carries config and slash caches into a process-free draft", () => {
    const cachedConfigOptions = [{
      id: "model",
      name: "Model",
      type: "select" as const,
      currentValue: "cached-model",
      options: [{ value: "cached-model", name: "Cached Model" }],
    }];
    const cachedSlashCommands = [{
      name: "compact",
      description: "Compact context",
      source: "acp" as const,
    }];

    expect(buildSessionOptions("acp", getModel, {
      id: "pi-acp",
      name: "Pi",
      engine: "acp",
      cachedConfigOptions,
      cachedSlashCommands,
    })).toMatchObject({
      cachedConfigOptions,
      cachedSlashCommands,
    });
  });

  it("provides Pi built-in slash commands before the first live session", () => {
    const options = buildSessionOptions("acp", getModel, BUILTIN_PI_AGENT);

    expect(options.cachedSlashCommands?.map((command) => command.name)).toContain("compact");
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
