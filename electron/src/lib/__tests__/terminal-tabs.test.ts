import { describe, expect, it } from "vitest";
import {
  parseStoredTerminalState,
  reconcileTerminalState,
} from "../../../../src/lib/terminal-tabs";
import {
  listTerminalShellOptions,
  resolveTerminalShell,
} from "../terminal-shell";

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
    findExecutable: (_name: string) => null,
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
    )).toThrow("existing absolute executable path");
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
});
