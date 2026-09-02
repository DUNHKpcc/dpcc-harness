import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ACPConfigOption } from "@shared/types/acp";
import type { SlashCommand } from "@shared/types/engine";

const originalPlatform = process.platform;
const originalArch = process.arch;
const userDataDir = "/tmp/pcc-agent-test";
const agentsPath = path.join(userDataDir, "pcc-agent-data", "agents.json");

const cachedModelOption: ACPConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "provider/model-a",
  options: [{ value: "provider/model-a", name: "Model A" }],
};
const cachedSlashCommand: SlashCommand = {
  name: "compact",
  description: "Compact context",
  source: "acp",
};

const {
  mockExecFile,
  mockListPiUpstreamModels,
  mockResolvePiUpstream,
} = vi.hoisted(() => ({
  mockExecFile: (() => {
    const fn = vi.fn();
    return Object.assign(fn, {
      [Symbol.for("nodejs.util.promisify.custom")]: (
        command: string,
        args: string[],
      ) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        fn(command, args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      }),
    });
  })(),
  mockListPiUpstreamModels: vi.fn(),
  mockResolvePiUpstream: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/pcc-agent-test",
  },
}));

vi.mock("../logger", () => ({ log: vi.fn() }));

vi.mock("../pi-acp-config", () => ({
  listPiUpstreamModels: mockListPiUpstreamModels,
}));

vi.mock("../upstream-resolver", () => ({
  resolvePiUpstream: mockResolvePiUpstream,
}));

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

function setPlatform(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: arch,
    configurable: true,
  });
}

function restorePlatform(): void {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: originalArch,
    configurable: true,
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../agent-registry");
}

describe("getRegistryPlatformKeys", () => {
  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    mockExecFile.mockReset();
  });

  it("uses Windows x64 registry targets on Windows x64", async () => {
    setPlatform("win32", "x64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["windows-x86_64"]);
  });

  it("does not expose Windows arm64 registry targets", async () => {
    setPlatform("win32", "arm64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["windows-x86_64"]);
  });

  it("keeps macOS arm64 registry targets", async () => {
    setPlatform("darwin", "arm64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["darwin-aarch64"]);
  });
});

describe("checkBinaries", () => {
  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    mockExecFile.mockReset();
  });

  it("checks the Windows x64 binary target on Windows arm64", async () => {
    setPlatform("win32", "arm64");
    mockExecFile.mockImplementation(
      (command: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        expect(command).toBe("where");
        expect(args).toEqual(["agent-x64"]);
        cb(null, "C:\\Tools\\agent-x64.exe\r\n", "");
      },
    );
    const { checkBinaries } = await loadModule();

    await expect(checkBinaries([
      {
        id: "agent",
        binary: {
          "windows-aarch64": { cmd: "agent-arm64" },
          "windows-x86_64": { cmd: "agent-x64", args: ["acp"] },
        },
      },
    ])).resolves.toEqual({
      agent: { path: "C:\\Tools\\agent-x64.exe", args: ["acp"] },
    });
  });
});

describe("built-in Pi draft cache", () => {
  it("restores only cached draft metadata from an old built-in record", async () => {
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(agentsPath, JSON.stringify([{
      id: "pi-acp",
      name: "Tampered Pi",
      engine: "acp",
      builtIn: false,
      binary: "npx",
      args: ["malicious-package"],
      cachedConfigOptions: [cachedModelOption],
      cachedSlashCommands: [cachedSlashCommand],
    }]));
    const { getAgent, loadUserAgents } = await loadModule();

    loadUserAgents();

    expect(getAgent("pi-acp")).toMatchObject({
      id: "pi-acp",
      name: "Pi",
      builtIn: true,
      binary: "bundled:pi-acp",
      cachedConfigOptions: [cachedModelOption],
      cachedSlashCommands: [cachedSlashCommand],
    });
  });

  it("persists live config updates for the protected built-in", async () => {
    const { updateCachedConfig } = await loadModule();

    updateCachedConfig("pi-acp", [cachedModelOption]);

    const persisted = JSON.parse(fs.readFileSync(agentsPath, "utf-8"));
    expect(persisted).toEqual([expect.objectContaining({
      id: "pi-acp",
      builtIn: true,
      binary: "bundled:pi-acp",
      cachedConfigOptions: [cachedModelOption],
    })]);
  });

  it("persists live slash commands without replacing the protected launch definition", async () => {
    const { updateCachedSlashCommands } = await loadModule();

    updateCachedSlashCommands("pi-acp", [cachedSlashCommand]);

    const persisted = JSON.parse(fs.readFileSync(agentsPath, "utf-8"));
    expect(persisted).toEqual([expect.objectContaining({
      id: "pi-acp",
      builtIn: true,
      binary: "bundled:pi-acp",
      cachedSlashCommands: [cachedSlashCommand],
    })]);
  });
});

describe("built-in Pi model catalog refresh", () => {
  afterEach(() => {
    mockListPiUpstreamModels.mockReset();
    mockResolvePiUpstream.mockReset();
  });

  it("replaces the cached model catalog without starting Pi or resetting thinking", async () => {
    const thinkingOption: ACPConfigOption = {
      id: "thought_level",
      name: "Thinking",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    };
    mockResolvePiUpstream.mockReturnValue({
      tier: "default",
      model: "",
      providers: [
        { id: "provider", name: "DPCC API (Claude)" },
      ],
    });
    mockListPiUpstreamModels.mockResolvedValue({
      models: ["provider/model-a", "provider/model-b"],
      error: null,
    });
    const registry = await loadModule();
    registry.updateCachedConfig("pi-acp", [cachedModelOption, thinkingOption]);
    registry.updateCachedSlashCommands("pi-acp", [cachedSlashCommand]);
    const { refreshBuiltInPiModelCache } = await import("../pi-model-cache");
    const firstRefresh = refreshBuiltInPiModelCache();
    const concurrentRefresh = refreshBuiltInPiModelCache();

    expect(concurrentRefresh).toBe(firstRefresh);
    await expect(Promise.all([firstRefresh, concurrentRefresh])).resolves.toEqual([
      { ok: true, modelCount: 2, updated: true },
      { ok: true, modelCount: 2, updated: true },
    ]);
    expect(mockListPiUpstreamModels).toHaveBeenCalledTimes(1);
    expect(registry.getAgent("pi-acp")?.cachedConfigOptions).toEqual([
      {
        ...cachedModelOption,
        options: [
          {
            value: "provider/model-a",
            name: "provider/model-a (DPCC API (Claude))",
            description: null,
          },
          {
            value: "provider/model-b",
            name: "provider/model-b (DPCC API (Claude))",
            description: null,
          },
        ],
      },
      thinkingOption,
    ]);
    expect(registry.getAgent("pi-acp")?.cachedSlashCommands).toEqual([cachedSlashCommand]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("keeps the offline cache when the live catalog cannot be refreshed", async () => {
    mockResolvePiUpstream.mockReturnValue({
      tier: "default",
      model: "",
      providers: [],
    });
    mockListPiUpstreamModels.mockResolvedValue({ models: [], error: "no_token" });
    const registry = await loadModule();
    registry.updateCachedConfig("pi-acp", [cachedModelOption]);
    const { refreshBuiltInPiModelCache } = await import("../pi-model-cache");

    await expect(refreshBuiltInPiModelCache()).resolves.toEqual({
      ok: false,
      error: "no_token",
    });
    expect(registry.getAgent("pi-acp")?.cachedConfigOptions).toEqual([cachedModelOption]);
  });
});
