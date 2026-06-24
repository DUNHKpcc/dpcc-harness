import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAccessSync,
  mockExecFile,
  mockExecFileSync,
  mockGetAppSetting,
  mockGetCliPath,
  mockLog,
  mockSpawn,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockGetAppSetting: vi.fn<(key: string) => string>((key: string) => {
    if (key === "claudeBinarySource") return "auto";
    if (key === "claudeCustomBinaryPath") return "";
    return "PccAgent";
  }),
  mockGetCliPath: vi.fn(() => "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
  mockLog: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    accessSync: mockAccessSync,
    constants: { X_OK: 1 },
  },
}));

vi.mock("os", () => ({
  default: {
    homedir: () => "/Users/tester",
  },
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../sdk", () => ({
  getCliPath: mockGetCliPath,
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

function allowExecutable(...filePaths: string[]): void {
  mockAccessSync.mockImplementation((candidate: string) => {
    if (filePaths.includes(candidate)) return;
    throw new Error("missing");
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../claude-binary");
}

describe("claude binary resolution", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockAccessSync.mockReset();
    mockExecFile.mockReset();
    mockExecFile.mockImplementation((_command: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error("missing"));
    });
    mockExecFileSync.mockReset();
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "auto";
      if (key === "claudeCustomBinaryPath") return "";
      return "PccAgent";
    });
    mockGetCliPath.mockReset();
    mockGetCliPath.mockReturnValue("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    mockLog.mockReset();
    mockSpawn.mockReset();
  });

  it("uses a valid custom executable path", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "custom";
      if (key === "claudeCustomBinaryPath") return "/opt/bin/claude";
      return "PccAgent";
    });
    allowExecutable("/opt/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath()).resolves.toBe("/opt/bin/claude");
  });

  it("falls back to the bundled cli when the custom path is empty (C1)", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "custom";
      if (key === "claudeCustomBinaryPath") return "";
      return "PccAgent";
    });
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    // An unset custom path must not hard-fail the session — it falls back to cli.js.
    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
    expect(mockLog).toHaveBeenCalledWith("CLAUDE_BINARY_CUSTOM_UNSET", expect.any(String));
  });

  it("falls back to the bundled cli when the custom path is not executable (C1)", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "custom";
      if (key === "claudeCustomBinaryPath") return "/opt/bin/claude";
      return "PccAgent";
    });
    // /opt/bin/claude is configured but missing; only the bundled cli is executable.
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
    expect(mockLog).toHaveBeenCalledWith("CLAUDE_BINARY_CUSTOM_INVALID", expect.any(String));
  });

  it("always uses the bundled SDK cli in builtin mode, ignoring a system claude", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "builtin";
      if (key === "claudeCustomBinaryPath") return "";
      return "PccAgent";
    });
    // A system claude exists on PATH — builtin must deterministically ignore it.
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === "which") return "/usr/local/bin/claude\n";
      throw new Error("unexpected");
    });
    allowExecutable("/usr/local/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
  });

  it("never runs the native installer in builtin mode, and reports installed", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "builtin";
      if (key === "claudeCustomBinaryPath") return "";
      return "PccAgent";
    });
    allowExecutable(); // nothing on disk

    const mod = await loadModule();

    // Built-in is always "installed" (it IS the bundle), even with allowSdkFallback:false.
    expect(mod.getClaudeBinaryStatus()).toEqual({ installed: true, installing: false });
    await expect(mod.getClaudeBinaryPath({ installIfMissing: true })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("prefers the env override in auto mode", async () => {
    vi.stubEnv("CLAUDE_CODE_CLI_PATH", "/env/claude");
    allowExecutable("/env/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/env/claude");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("finds the native shim in the user local bin directory", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/Users/tester/.local/bin/claude");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("falls back to PATH lookup when the shim is missing", async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, "/usr/local/bin/claude\n");
    });
    allowExecutable("/usr/local/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/usr/local/bin/claude");
    expect(mockExecFile).toHaveBeenCalledWith(
      "which",
      ["claude"],
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
      expect.any(Function),
    );
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("uses the sdk cli fallback in auto mode when native resolution fails", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("missing");
    });
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false, allowSdkFallback: true })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
    expect(mockLog).toHaveBeenCalledWith(
      "CLAUDE_BINARY_SELECTED",
      "strategy=sdk-fallback path=/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
  });

  it("reports status without triggering install", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");
    const mod = await loadModule();

    expect(mod.getClaudeBinaryStatus()).toEqual({
      installed: true,
      installing: false,
    });
  });

  it("runs a script-path version probe as Node (ELECTRON_RUN_AS_NODE), never a second GUI app", async () => {
    mockExecFileSync.mockImplementation(
      (command: string, args: string[], opts: { windowsHide?: boolean; env?: Record<string, string> }) => {
        if (command === process.execPath) {
          expect(args).toEqual(["/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js", "--version"]);
          // Without ELECTRON_RUN_AS_NODE the packaged .exe would boot a full GUI
          // instance instead of executing cli.js (the Windows double-window bug).
          expect(opts.env?.ELECTRON_RUN_AS_NODE).toBe("1");
          expect(opts.windowsHide).toBe(true);
          return "2.1.70\n";
        }
        throw new Error("unexpected");
      },
    );
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    await expect(mod.getClaudeVersion()).resolves.toBe("2.1.70");
  });

  it("exposes binary metadata for auto-detected paths", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");

    const mod = await loadModule();

    expect(mod.getClaudeBinaryMetadata({ installIfMissing: false, allowSdkFallback: true })).toEqual({
      path: "/Users/tester/.local/bin/claude",
      strategy: "known",
      source: "auto",
    });
  });

  it("exposes binary info for the settings UI", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "/Users/tester/.local/bin/claude") {
        expect(args).toEqual(["--version"]);
        return "2.1.181\n";
      }
      throw new Error("unexpected");
    });

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryInfo()).resolves.toEqual({
      path: "/Users/tester/.local/bin/claude",
      origin: "known",
      source: "auto",
      version: "2.1.181",
    });
  });

  it("reads a provided binary path version directly", async () => {
    mockExecFileSync.mockImplementation(
      (command: string, args: string[], opts: { env?: Record<string, string> }) => {
        if (command === "/Users/tester/.local/bin/claude") {
          expect(args).toEqual(["--version"]);
          // A real binary is spawned directly — it must NOT be forced into Node mode.
          expect(opts.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
          return "1.2.3\n";
        }
        throw new Error("unexpected");
      },
    );

    const mod = await loadModule();

    await expect(mod.getClaudeVersion("/Users/tester/.local/bin/claude")).resolves.toBe("1.2.3");
  });
});
