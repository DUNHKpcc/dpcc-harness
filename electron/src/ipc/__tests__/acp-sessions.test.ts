import { describe, expect, it } from "vitest";
import { buildAcpMcpServers, selectAcpStartCleanupProcess, shouldUseWindowsShellForAcpBinary } from "../acp-sessions";

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
