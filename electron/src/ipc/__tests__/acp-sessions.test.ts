import { describe, expect, it, vi } from "vitest";
import { AcpSessionOperationCoordinator } from "../../lib/acp-session-operations";
import { normalizeAcpStartCancellationReason } from "@shared/lib/acp-start";
import {
  buildAcpLifecycleErrorDetails,
  buildAcpMcpServers,
  buildAcpPromptTransportErrorDetails,
  reconcileInitialAcpConfigOptions,
  resolveConfigOptions,
  resolveAcpRuntimeSessionId,
  resolveAcpPromptInactivityTimeoutMs,
  selectAcpStartCleanupProcess,
  shouldSuppressAcpSessionUpdate,
  shouldUseWindowsShellForAcpBinary,
  summarizeUpdate,
  supportsInProcessMcpReload,
  withAcpPromptInactivityTimeout,
} from "../acp-sessions";

vi.mock("../../lib/logger", () => ({ log: vi.fn() }));

describe("normalizeAcpStartCancellationReason", () => {
  it("preserves known renderer reasons and fails closed for unknown IPC input", () => {
    expect(normalizeAcpStartCancellationReason("user_stop")).toBe("user_stop");
    expect(normalizeAcpStartCancellationReason("switch_session")).toBe("switch_session");
    expect(normalizeAcpStartCancellationReason("unexpected")).toBe("cleanup");
    expect(normalizeAcpStartCancellationReason(null)).toBe("cleanup");
  });
});

describe("summarizeUpdate", () => {
  it("reports Pi terminal delta and exit metadata without logging output", () => {
    expect(summarizeUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "bash-tool-call-id",
      status: "completed",
      _meta: {
        terminal_output: { terminal_id: "bash-tool-call-id", data: "secret output" },
        terminal_exit: { terminal_id: "bash-tool-call-id", exit_code: 0, signal: null },
      },
    })).toBe(
      "tool_call_update id=bash-tool-ca status=completed title=\"\" hasOutput=false content_items=0 terminal_delta_len=13 exit_code=0",
    );
  });
});

describe("buildAcpLifecycleErrorDetails", () => {
  it("preserves stable Pi preflight codes without leaking credentials", () => {
    const error = Object.assign(
      new Error("Bundled Pi missing; authorization: Bearer secret-value"),
      { code: "pi_bundled_package_missing" },
    );

    expect(buildAcpLifecycleErrorDetails(error, "acp_start_failed", "initialize"))
      .toEqual(expect.objectContaining({
        code: "pi_bundled_package_missing",
        source: "pi",
        stage: "spawn",
        retryable: false,
        message: "Bundled Pi missing; authorization: Bearer [REDACTED]",
      }));
  });

  it("uses the operation fallback for untagged transport failures", () => {
    expect(buildAcpLifecycleErrorDetails(
      new Error("initialize failed"),
      "acp_revive_failed",
      "initialize",
    )).toEqual(expect.objectContaining({
      code: "acp_revive_failed",
      source: "acp",
      stage: "initialize",
      retryable: true,
    }));
  });
});

describe("ACP prompt transport failures", () => {
  it("keeps child exit, upstream stderr and protocol failures distinguishable", () => {
    expect(buildAcpPromptTransportErrorDetails(
      new Error("pi process exited (code=17, signal=null)"),
      { isOfficialPi: true },
    )).toEqual(expect.objectContaining({
      code: "pi_child_exit",
      source: "pi",
      stage: "prompt",
    }));
    expect(buildAcpPromptTransportErrorDetails(
      Object.assign(new Error("Internal error"), { code: "ECONNRESET" }),
      { isOfficialPi: true, stderrMessage: "provider HTTP 429 rate limit" },
    )).toEqual(expect.objectContaining({
      code: "pi_upstream_error",
      source: "upstream",
      stage: "prompt",
    }));
    expect(buildAcpPromptTransportErrorDetails(
      new Error("invalid JSON-RPC response"),
      { isOfficialPi: false },
    )).toEqual(expect.objectContaining({
      code: "acp_protocol_error",
      source: "acp",
      retryable: false,
    }));
  });

  it("fails a prompt after the configured inactivity window", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const pending = new Promise<never>(() => undefined);
      const result = withAcpPromptInactivityTimeout(pending, () => startedAt, 100);
      const rejection = expect(result).rejects.toMatchObject({ code: "acp_prompt_timeout" });

      await vi.advanceTimersByTimeAsync(101);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the pinned production timeout when an override is invalid", () => {
    expect(resolveAcpPromptInactivityTimeoutMs("not-a-number")).toBe(15 * 60 * 1000);
    expect(resolveAcpPromptInactivityTimeoutMs("250")).toBe(250);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("resolveAcpRuntimeSessionId", () => {
  it("preserves the persisted dpcc session ID when reviving an ACP transport", () => {
    expect(resolveAcpRuntimeSessionId(" persisted-session ", () => "generated-session"))
      .toBe("persisted-session");
  });

  it("generates an ID for a brand-new ACP session", () => {
    expect(resolveAcpRuntimeSessionId(undefined, () => "generated-session"))
      .toBe("generated-session");
  });
});

describe("resolveConfigOptions", () => {
  const cachedOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select" as const,
    currentValue: "cached/model",
    options: [{ value: "cached/model", name: "Cached Model" }],
  };

  it("uses the agent cache when a revived runtime returns no selectors", () => {
    expect(resolveConfigOptions(
      {},
      "revive-cache-fallback",
      "ACP_REVIVE_TEST",
      [cachedOption],
    )).toEqual([cachedOption]);
  });

  it("keeps live runtime selectors authoritative over the cache", () => {
    const liveOption = {
      ...cachedOption,
      currentValue: "live/model",
      options: [{ value: "live/model", name: "Live Model" }],
    };

    expect(resolveConfigOptions(
      { configOptions: [liveOption] },
      "revive-live-precedence",
      "ACP_REVIVE_TEST",
      [cachedOption],
    )).toEqual([liveOption]);
  });

  it("applies cached model before thinking and returns the runtime-corrected catalog", async () => {
    const thoughtOption = {
      id: "thought_level",
      name: "Thinking",
      category: "thought_level",
      type: "select" as const,
      currentValue: "low",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    };
    const liveOptions = [{
      ...cachedOption,
      currentValue: "live/model-a",
      options: [
        { value: "live/model-a", name: "Model A" },
        { value: "live/model-b", name: "Model B" },
      ],
    }, thoughtOption];
    const requestedOptions = [{ ...thoughtOption, currentValue: "high" }, {
      ...liveOptions[0],
      currentValue: "live/model-b",
    }];
    const calls: string[] = [];
    let appliedOptions = liveOptions;

    const result = await reconcileInitialAcpConfigOptions(
      liveOptions,
      requestedOptions,
      async (configId, value) => {
        calls.push(`${configId}=${value}`);
        appliedOptions = appliedOptions.map((option) => (
          option.id === configId ? { ...option, currentValue: value } : option
        ));
        return appliedOptions;
      },
    );

    expect(calls).toEqual(["model=live/model-b", "thought_level=high"]);
    expect(result.find((option) => option.id === "model")?.currentValue).toBe("live/model-b");
    expect(result.find((option) => option.id === "thought_level")?.currentValue).toBe("high");
  });

  it("skips stale cached values that the live runtime no longer advertises", async () => {
    const apply = vi.fn();
    const result = await reconcileInitialAcpConfigOptions(
      [{
        ...cachedOption,
        currentValue: "live/model",
        options: [{ value: "live/model", name: "Live Model" }],
      }],
      [cachedOption],
      apply,
    );

    expect(apply).not.toHaveBeenCalled();
    expect(result[0].currentValue).toBe("live/model");
  });
});

describe("shouldUseWindowsShellForAcpBinary", () => {
  it("uses the shell for Windows batch shims and bare commands", () => {
    expect(shouldUseWindowsShellForAcpBinary("npx", "win32")).toBe(true);
    expect(shouldUseWindowsShellForAcpBinary("agent.cmd", "win32")).toBe(true);
    expect(shouldUseWindowsShellForAcpBinary("C:\\Tools\\agent.bat", "win32")).toBe(true);
  });

  it("spawns Windows executables and explicit non-batch paths directly", () => {
    expect(shouldUseWindowsShellForAcpBinary("agent.exe", "win32")).toBe(false);
    expect(shouldUseWindowsShellForAcpBinary("C:\\Program Files\\Agent\\agent.exe", "win32")).toBe(false);
    expect(shouldUseWindowsShellForAcpBinary("C:\\Tools\\agent", "win32")).toBe(false);
  });

  it("does not use a shell on non-Windows platforms", () => {
    expect(shouldUseWindowsShellForAcpBinary("npx", "darwin")).toBe(false);
    expect(shouldUseWindowsShellForAcpBinary("agent.cmd", "linux")).toBe(false);
  });
});

describe("selectAcpStartCleanupProcess", () => {
  const pendingProcess = { pid: 101, kill: () => undefined };
  const connectedProcess = { pid: 202, kill: () => undefined };

  it("falls back to the pending start process when connection setup fails before returning", () => {
    expect(selectAcpStartCleanupProcess(null, { id: "pending", process: pendingProcess })).toBe(pendingProcess);
  });

  it("prefers the connected process after connection setup returned", () => {
    expect(selectAcpStartCleanupProcess({ proc: connectedProcess }, { id: "pending", process: pendingProcess })).toBe(connectedProcess);
  });
});

describe("supportsInProcessMcpReload", () => {
  it("forces built-in Pi to restart so its process-scoped MCP config is applied", () => {
    expect(supportsInProcessMcpReload({
      supportsLoadSession: true,
      isOfficialPi: true,
    })).toBe(false);
    expect(supportsInProcessMcpReload({
      supportsLoadSession: true,
      isOfficialPi: false,
    })).toBe(true);
    expect(supportsInProcessMcpReload({
      supportsLoadSession: false,
      isOfficialPi: false,
    })).toBe(false);
  });
});

describe("shouldSuppressAcpSessionUpdate", () => {
  it("drops unsolicited startup text before the ACP session ID is known", () => {
    expect(shouldSuppressAcpSessionUpdate(undefined, "pi-session", "agent_message_chunk")).toBe(true);
    expect(shouldSuppressAcpSessionUpdate(undefined, "pi-session", "agent_thought_chunk")).toBe(true);
    expect(shouldSuppressAcpSessionUpdate(undefined, "pi-session", "config_option_update")).toBe(false);
  });

  it("drops delayed welcome text until the first user prompt starts", () => {
    expect(shouldSuppressAcpSessionUpdate(
      "pi-session",
      "pi-session",
      "agent_message_chunk",
      false,
    )).toBe(true);
    expect(shouldSuppressAcpSessionUpdate(
      "pi-session",
      "pi-session",
      "agent_message_chunk",
      true,
    )).toBe(false);
  });

  it("keeps the active chat isolated from other ACP sessions", () => {
    expect(shouldSuppressAcpSessionUpdate("chat-session", "utility-session", "agent_message_chunk", true)).toBe(true);
    expect(shouldSuppressAcpSessionUpdate("chat-session", "chat-session", "agent_message_chunk", true)).toBe(false);
  });
});

describe("AcpSessionOperationCoordinator", () => {
  it("keeps title generation behind the first user turn", async () => {
    const coordinator = new AcpSessionOperationCoordinator();
    const userTurn = deferred<string>();
    const order: string[] = [];

    const utility = coordinator.runUtilityPrompt(async () => {
      order.push("utility");
      return "title";
    }, true);
    const user = coordinator.runUserPrompt(async () => {
      order.push("user");
      return userTurn.promise;
    });

    await Promise.resolve();
    expect(order).toEqual(["user"]);
    userTurn.resolve("answer");
    await expect(user).resolves.toBe("answer");
    await expect(utility).resolves.toBe("title");
    expect(order).toEqual(["user", "utility"]);
  });

  it("prioritizes another user turn over queued title generation", async () => {
    const coordinator = new AcpSessionOperationCoordinator();
    const firstTurn = deferred<void>();
    const order: string[] = [];

    const first = coordinator.runUserPrompt(async () => {
      order.push("user-1");
      return firstTurn.promise;
    });
    const utility = coordinator.runUtilityPrompt(async () => {
      order.push("utility");
    }, true);
    const second = coordinator.runUserPrompt(async () => {
      order.push("user-2");
    });

    firstTurn.resolve();
    await Promise.all([first, second, utility]);
    expect(order).toEqual(["user-1", "user-2", "utility"]);
  });

  it("rejects queued title work when the session closes", async () => {
    const coordinator = new AcpSessionOperationCoordinator();
    const operation = vi.fn(async () => "unused");
    const utility = coordinator.runUtilityPrompt(operation, true);

    coordinator.close("transport stopped");

    await expect(utility).rejects.toThrow("transport stopped");
    expect(operation).not.toHaveBeenCalled();
  });

  it("rejects queued user turns without closing the session", async () => {
    const coordinator = new AcpSessionOperationCoordinator();
    const firstTurn = deferred<void>();
    const secondOperation = vi.fn(async () => "second");

    const first = coordinator.runUserPrompt(() => firstTurn.promise);
    const second = coordinator.runUserPrompt(secondOperation);

    expect(coordinator.cancelQueuedUserPrompts()).toBe(1);
    await expect(second).rejects.toThrow("ACP turn cancelled");
    expect(secondOperation).not.toHaveBeenCalled();

    firstTurn.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(coordinator.runUserPrompt(async () => "third")).resolves.toBe("third");
  });
});

describe("buildAcpMcpServers", () => {
  it("normalizes npm exec stdio MCP launchers on macOS", async () => {
    await expect(buildAcpMcpServers([{
      name: "xcodebuild",
      transport: "stdio",
      command: "npm",
      args: ["exec", "xcodebuildmcp@latest", "mcp"],
      env: { FOO: "bar" },
    }], { platform: "darwin" })).resolves.toEqual([{
      name: "xcodebuild",
      command: "npx",
      args: ["--yes", "xcodebuildmcp@latest", "mcp"],
      env: [{ name: "FOO", value: "bar" }],
    }]);
  });
});
