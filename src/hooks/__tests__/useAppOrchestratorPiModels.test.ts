import { describe, expect, it } from "vitest";
import { normalizeNewSessionIdentity } from "@shared/lib/session-runtime";
import { resolveModelValue } from "@/lib/model-utils";
import {
  resolveAcpBoundSessionId,
  resolveAcpInitialRuntimeState,
} from "@/hooks/session/useSessionPane";
import type { ACPConfigOption, SlashCommand } from "@/types";

describe("Pi runtime model selection", () => {
  it("always normalizes a new session to the ACP Pi identity", () => {
    expect(normalizeNewSessionIdentity({ engine: "claude", agentId: "legacy" })).toEqual({
      engine: "acp",
      agentId: "pi-acp",
    });
  });

  it("keeps an explicitly selected custom ACP agent identity", () => {
    expect(normalizeNewSessionIdentity({ engine: "acp", agentId: "custom-acp" })).toEqual({
      engine: "acp",
      agentId: "custom-acp",
    });
  });

  it("uses the current Pi model when the catalog is temporarily unavailable", () => {
    expect(resolveModelValue("pcc-local-test", [])).toBeUndefined();
  });

  it("keeps read-only initial collections absent to avoid render loops", () => {
    const first = resolveAcpInitialRuntimeState(false, [], [], null);
    const second = resolveAcpInitialRuntimeState(false, [], [], null);

    expect(first).toEqual({
      initialConfigOptions: undefined,
      initialSlashCommands: undefined,
      initialRawAcpPermission: null,
    });
    expect(first.initialConfigOptions).toBe(second.initialConfigOptions);
    expect(first.initialSlashCommands).toBe(second.initialSlashCommands);
  });

  it("preserves live ACP initial collection references", () => {
    const initialConfigOptions: ACPConfigOption[] = [];
    const initialSlashCommands: SlashCommand[] = [];
    const state = resolveAcpInitialRuntimeState(
      true,
      initialConfigOptions,
      initialSlashCommands,
      null,
    );

    expect(state.initialConfigOptions).toBe(initialConfigOptions);
    expect(state.initialSlashCommands).toBe(initialSlashCommands);
  });

  it("keeps cached selectors for a dormant Pi session without binding its dead runtime ID", () => {
    const initialConfigOptions: ACPConfigOption[] = [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "provider/model",
      options: [{ value: "provider/model", name: "Model" }],
    }];

    expect(resolveAcpInitialRuntimeState(true, initialConfigOptions, [], null).initialConfigOptions)
      .toBe(initialConfigOptions);
    expect(resolveAcpBoundSessionId(true, false, "persisted-session"))
      .toBeNull();
    expect(resolveAcpBoundSessionId(true, true, "persisted-session"))
      .toBe("persisted-session");
  });
});
