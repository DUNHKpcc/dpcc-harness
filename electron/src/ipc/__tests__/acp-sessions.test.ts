import { describe, expect, it, vi } from "vitest";
import { AcpSessionOperationCoordinator } from "../../lib/acp-session-operations";
import {
  buildAcpMcpServers,
  resolveAcpRuntimeSessionId,
  selectAcpStartCleanupProcess,
  shouldSuppressAcpSessionUpdate,
  shouldUseWindowsShellForAcpBinary,
} from "../acp-sessions";

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
