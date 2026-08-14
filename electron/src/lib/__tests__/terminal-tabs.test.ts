import { describe, expect, it } from "vitest";
import {
  parseStoredTerminalState,
  reconcileTerminalState,
} from "../../../../src/lib/terminal-tabs";
import {
  getTerminalSpawnEnvironment,
  listTerminalShellOptions,
  resolveTerminalShell,
} from "../terminal-shell";
import {
  buildQuitWarningCopy,
  hasInterruptibleWork,
} from "../quit-protection";

function terminalShellRuntime(
  platform: NodeJS.Platform,
  existing: string[],
  env: NodeJS.ProcessEnv = {},
) {
  const files = new Set(existing);
  return {
    platform,
    env,
    fileExists: (filePath: string) => files.has(filePath),
    fileIsExecutable: (filePath: string) => files.has(filePath),
    findExecutable: (_name: string) => null,
    readWindowsPathEntries: () => [],
    discoverWindowsPowerShellLocations: () => [],
    probePowerShell: (filePath: string) => files.has(filePath)
      ? { valid: true, version: "7.6.0" }
      : { valid: false, error: "missing" },
  };
}

describe("terminal tabs state", () => {
  it("keeps persisted tab metadata for live terminals and drops stale ones", () => {
    const persisted = parseStoredTerminalState(JSON.stringify({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Build" },
          { id: "term-stale", terminalId: "term-stale", label: "Old" },
        ],
        activeTabId: "term-a",
      },
    }));

    expect(reconcileTerminalState(persisted, [
      { terminalId: "term-a", spaceId: "default", createdAt: 1 },
    ])).toEqual({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Build" },
        ],
        activeTabId: "term-a",
      },
    });
  });

  it("recovers live terminals missing from persisted state without duplicates", () => {
    expect(reconcileTerminalState({}, [
      { terminalId: "term-a", spaceId: "default", createdAt: 1 },
      { terminalId: "term-b", spaceId: "default", createdAt: 2 },
    ])).toEqual({
      default: {
        tabs: [
          { id: "term-a", terminalId: "term-a", label: "Terminal 1" },
          { id: "term-b", terminalId: "term-b", label: "Terminal 2" },
        ],
        activeTabId: "term-b",
      },
    });
  });
});

describe("terminal shell resolution", () => {
  it("keeps the Windows system default in auto mode", () => {
    const comSpec = "C:\\Windows\\System32\\cmd.exe";
    expect(resolveTerminalShell("auto", "", terminalShellRuntime("win32", [comSpec], {
      COMSPEC: comSpec,
    }))).toEqual({ shellPath: comSpec, args: [] });
  });

  it("resolves PowerShell 7 from its standard Windows install", () => {
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    expect(resolveTerminalShell("pwsh", "", terminalShellRuntime("win32", [pwsh], {
      ProgramFiles: "C:\\Program Files",
    }))).toEqual({ shellPath: pwsh, args: [] });
  });

  it("keeps the macOS login shell in auto mode", () => {
    expect(resolveTerminalShell("auto", "", terminalShellRuntime("darwin", ["/bin/zsh"], {
      SHELL: "/bin/zsh",
    }))).toEqual({ shellPath: "/bin/zsh", args: [] });
  });

  it("falls back to bash on Linux when SHELL is unavailable", () => {
    expect(resolveTerminalShell("auto", "", terminalShellRuntime("linux", ["/bin/bash"], {
      SHELL: "/missing/shell",
    }))).toEqual({ shellPath: "/bin/bash", args: [] });
  });

  it("requires an existing absolute custom shell path", () => {
    expect(() => resolveTerminalShell(
      "custom",
      "relative/zsh",
      terminalShellRuntime("darwin", ["relative/zsh"]),
    )).toThrow("must be absolute");
    expect(resolveTerminalShell(
      "custom",
      "/opt/homebrew/bin/fish",
      terminalShellRuntime("darwin", ["/opt/homebrew/bin/fish"]),
    )).toEqual({ shellPath: "/opt/homebrew/bin/fish", args: [] });
  });

  it("reports platform-specific options and availability", () => {
    const options = listTerminalShellOptions(
      terminalShellRuntime("darwin", ["/bin/zsh", "/bin/bash"]),
    );
    expect(options.map((option) => option.shell)).toEqual([
      "auto",
      "zsh",
      "bash",
      "fish",
      "pwsh",
    ]);
    expect(options.find((option) => option.shell === "zsh")).toMatchObject({
      available: true,
      path: "/bin/zsh",
    });
    expect(options.find((option) => option.shell === "fish")).toMatchObject({
      available: false,
    });
  });

  it("refreshes the Windows PATH before resolving PowerShell 7", () => {
    const pwsh = "C:\\Tools\\PowerShell\\pwsh.exe";
    const files = new Set([pwsh]);
    const runtime = {
      platform: "win32" as const,
      env: { Path: "C:\\Old", SystemRoot: "C:\\Windows" },
      fileExists: (filePath: string) => files.has(filePath),
      fileIsExecutable: (filePath: string) => files.has(filePath),
      readWindowsPathEntries: () => ["C:\\Tools\\PowerShell"],
      discoverWindowsPowerShellLocations: () => [],
      findExecutable: (_name: string, searchEnv?: NodeJS.ProcessEnv) =>
        searchEnv?.Path?.includes("C:\\Tools\\PowerShell") ? pwsh : null,
      probePowerShell: () => ({ valid: true, version: "7.6.1" }),
    };

    expect(resolveTerminalShell("pwsh", "", runtime)).toEqual({ shellPath: pwsh, args: [] });
    expect(listTerminalShellOptions(runtime).find((option) => option.shell === "pwsh"))
      .toMatchObject({ available: true, path: pwsh, source: "path", version: "7.6.1" });
    expect(getTerminalSpawnEnvironment(runtime).Path).toBe("C:\\Old;C:\\Tools\\PowerShell");
  });

  it("resolves the Microsoft Store app execution alias", () => {
    const pwsh = "C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
    const options = listTerminalShellOptions(terminalShellRuntime("win32", [pwsh], {
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    }));

    expect(options.find((option) => option.shell === "pwsh")).toMatchObject({
      available: true,
      path: pwsh,
      source: "app-alias",
      version: "7.6.0",
    });
  });

  it("uses registered custom PowerShell install locations", () => {
    const pwsh = "D:\\Apps\\PowerShell\\pwsh.exe";
    const files = new Set([pwsh]);
    const runtime = {
      ...terminalShellRuntime("win32", [pwsh]),
      discoverWindowsPowerShellLocations: () => [{ path: pwsh, source: "registry" as const }],
    };

    expect(listTerminalShellOptions(runtime).find((option) => option.shell === "pwsh"))
      .toMatchObject({ available: true, path: pwsh, source: "registry" });
  });

  it("rejects a PowerShell candidate that cannot actually launch", () => {
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const runtime = {
      ...terminalShellRuntime("win32", [pwsh], { ProgramFiles: "C:\\Program Files" }),
      probePowerShell: () => ({ valid: false, error: "Access denied" }),
    };

    expect(listTerminalShellOptions(runtime).find((option) => option.shell === "pwsh"))
      .toMatchObject({
        available: false,
        diagnosticCode: "launch-failed",
        diagnostic: expect.stringContaining("Access denied"),
      });
    expect(() => resolveTerminalShell("pwsh", "", runtime)).toThrow("could not be started");
  });

  it("requires a Windows custom terminal path to point to an exe", () => {
    const script = "C:\\Tools\\shell.cmd";
    expect(() => resolveTerminalShell(
      "custom",
      script,
      terminalShellRuntime("win32", [script]),
    )).toThrow("must point to an .exe file");
  });
});

describe("quit protection", () => {
  it("only warns when quitting would stop an active task or terminal", () => {
    expect(hasInterruptibleWork({ agentTasks: 0, terminals: 0 })).toBe(false);
    expect(hasInterruptibleWork({ agentTasks: 1, terminals: 0 })).toBe(true);
    expect(hasInterruptibleWork({ agentTasks: 0, terminals: 1 })).toBe(true);
  });

  it("describes every process type in the localized warning", () => {
    const zh = buildQuitWarningCopy("zh-CN", { agentTasks: 2, terminals: 1 });
    expect(zh.message).toContain("中断");
    expect(zh.detail).toContain("2 个正在运行的 Agent 任务");
    expect(zh.detail).toContain("1 个终端进程");

    const en = buildQuitWarningCopy("en-US", { agentTasks: 1, terminals: 2 });
    expect(en.detail).toContain("1 running Agent task");
    expect(en.detail).toContain("2 terminal processes");
  });
});
