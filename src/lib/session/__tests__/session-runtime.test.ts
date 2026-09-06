import { describe, expect, it } from "vitest";
import {
  BUILTIN_PI_AGENT_ID,
  canUseSessionRuntime,
  getSessionRuntimeDisposition,
  isProtectedBuiltInPiAgent,
  newPiSessionIdentity,
} from "@shared/lib/session-runtime";
import { BUILTIN_PI_AGENT, PI_OFFICIAL_ICON } from "@shared/types/registry";
import { getAgentIcon, getSessionEngineIcon } from "@/lib/engine-icons";

describe("session runtime disposition", () => {
  it("defines new sessions as ACP Pi sessions", () => {
    expect(newPiSessionIdentity()).toEqual({ engine: "acp", agentId: BUILTIN_PI_AGENT_ID });
  });

  it.each(["claude", "codex"] as const)("keeps %s sessions read-only", (engine) => {
    const session = { engine, agentId: "old-agent" } as const;
    expect(getSessionRuntimeDisposition(session)).toEqual({
      kind: "legacy-read-only",
      engine,
    });
    expect(canUseSessionRuntime(session)).toBe(false);
  });

  it("does not mutate persisted ACP data while deriving its disposition", () => {
    const session = { engine: "acp" as const, agentId: "  custom-acp  " };
    expect(getSessionRuntimeDisposition(session)).toEqual({
      kind: "runtime",
      engine: "acp",
      agentId: "custom-acp",
    });
    expect(session.agentId).toBe("  custom-acp  ");
  });

  it("treats a missing historical engine as legacy Claude without enabling a runtime", () => {
    const session = { engine: undefined };
    expect(getSessionRuntimeDisposition(session)).toEqual({
      kind: "legacy-read-only",
      engine: "claude",
    });
    expect(canUseSessionRuntime(session)).toBe(false);
  });

  it("fails closed for an unknown engine without mutating the source record", () => {
    const session = { engine: "future-runtime", agentId: "pi-acp" };
    expect(getSessionRuntimeDisposition(session)).toEqual({
      kind: "invalid",
      engine: "future-runtime",
      errorCode: "session_invalid_engine",
    });
    expect(canUseSessionRuntime(session)).toBe(false);
    expect(session).toEqual({ engine: "future-runtime", agentId: "pi-acp" });
  });
});

describe("Pi visual identity", () => {
  it("requires the complete built-in identity before enabling Pi-only behavior", () => {
    expect(isProtectedBuiltInPiAgent(BUILTIN_PI_AGENT)).toBe(true);
    expect(isProtectedBuiltInPiAgent({ ...BUILTIN_PI_AGENT, registryId: "custom-pi" })).toBe(false);
    expect(isProtectedBuiltInPiAgent({ ...BUILTIN_PI_AGENT, engine: "claude" })).toBe(false);
  });

  it("routes every built-in Pi identity to the official badge", () => {
    expect(BUILTIN_PI_AGENT.icon).toBe(PI_OFFICIAL_ICON);
    expect(getAgentIcon(BUILTIN_PI_AGENT)).toBe(PI_OFFICIAL_ICON);
    expect(getSessionEngineIcon("acp", BUILTIN_PI_AGENT_ID)).toBe(PI_OFFICIAL_ICON);
    expect(getSessionEngineIcon("acp", undefined)).toBe(PI_OFFICIAL_ICON);
  });

  it("preserves custom ACP agent icons", () => {
    expect(getSessionEngineIcon("acp", "custom-agent", [{
      id: "custom-agent",
      name: "Custom Agent",
      engine: "acp",
      icon: "Terminal",
    }])).toBe("Terminal");
  });
});
