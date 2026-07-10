import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  resolveEffectiveClaudeModels: vi.fn(),
  getClaudeModelsCache: vi.fn(),
  setClaudeModelsCache: vi.fn(),
  getSDK: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", getVersion: () => "1.0.0" },
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) => {
      mocks.handlers.set(channel, handler);
    },
    on: vi.fn(),
  },
}));

vi.mock("../lib/sdk", () => ({
  getSDK: mocks.getSDK,
  getCliPath: vi.fn(() => undefined),
}));

vi.mock("../lib/claude-model-cache", () => ({
  getClaudeModelsCache: mocks.getClaudeModelsCache,
  setClaudeModelsCache: mocks.setClaudeModelsCache,
}));

vi.mock("../lib/claude-model-catalog", () => ({
  resolveEffectiveClaudeModels: mocks.resolveEffectiveClaudeModels,
}));

vi.mock("../lib/async-channel", () => ({
  AsyncChannel: class {
    close = vi.fn();
    push = vi.fn();
  },
}));

vi.mock("../lib/claude-binary", () => ({
  downloadClaudeUpdate: vi.fn(),
  getClaudeBinaryInfo: vi.fn(),
  getClaudeBinaryMetadata: vi.fn(() => undefined),
  getClaudeBinaryPath: vi.fn(),
  getClaudeSdkProcessOptions: vi.fn(() => ({ env: {} })),
  getClaudeBinaryStatus: vi.fn(),
  getClaudeVersion: vi.fn(),
}));

vi.mock("../lib/claude-gateway-env", () => ({
  prepareClaudeSpawnEnv: vi.fn(async () => ({})),
  claudeResolvedModel: vi.fn((model: string | undefined) => model),
  claudeSettingSources: vi.fn(() => []),
}));

vi.mock("../lib/error-utils", () => ({
  reportError: mocks.reportError,
}));

vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/safe-send", () => ({ safeSend: vi.fn() }));
vi.mock("../lib/mcp-oauth-flow", () => ({ getMcpAuthHeaders: vi.fn() }));
vi.mock("../lib/claude-codex-bridge-controller", () => ({ getClaudeCodexBridgeController: vi.fn() }));
vi.mock("../lib/claude-mcp-isolation", () => ({ applyClaudeMcpIsolation: vi.fn() }));
vi.mock("../lib/macos-dock-focus", () => ({ reclaimMacDockFocus: vi.fn() }));
vi.mock("../lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("../lib/session-cwd", () => ({ normalizeSessionCwd: (cwd: string | undefined) => cwd }));
vi.mock("@shared/lib/mcp-config", () => ({ buildSdkMcpConfig: vi.fn() }));
vi.mock("@shared/lib/claude-codex-bridge", () => ({ appendClaudeCodexBridgeServer: vi.fn() }));

const rawModels = [{
  value: "sonnet",
  displayName: "Sonnet",
  description: "Raw SDK metadata",
}];

const effectiveModels = [{
  value: "claude-sonnet-4-6",
  displayName: "Sonnet",
  description: "Raw SDK metadata",
}];

describe("Claude model IPC catalog", () => {
  beforeEach(async () => {
    mocks.handlers.clear();
    mocks.resolveEffectiveClaudeModels.mockReset();
    mocks.getClaudeModelsCache.mockReset();
    mocks.setClaudeModelsCache.mockReset();
    mocks.getSDK.mockReset();
    mocks.reportError.mockReset();

    mocks.resolveEffectiveClaudeModels.mockResolvedValue(effectiveModels);
    mocks.getClaudeModelsCache.mockReturnValue({ models: rawModels, updatedAt: 100 });
    mocks.setClaudeModelsCache.mockImplementation((models) => ({ models, updatedAt: 200 }));
    mocks.reportError.mockImplementation((code: string, error: unknown) => `${code}: ${String(error)}`);

    const { register, sessions } = await import("./claude-sessions");
    sessions.clear();
    register(() => null);
  });

  it("caches the raw supported models while returning the effective catalog", async () => {
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => rawModels) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.resolveEffectiveClaudeModels).toHaveBeenCalledWith(rawModels);
    expect(result).toEqual({ models: effectiveModels });
  });

  it("resolves an empty supported model list so DPCC ids can be synthesized", async () => {
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => []) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModels).toHaveBeenCalledWith([]);
    expect(result).toEqual({ models: effectiveModels });
  });

  it("resolves the persisted raw cache while preserving updatedAt", async () => {
    const result = await mocks.handlers.get("claude:models-cache:get")?.({});

    expect(mocks.resolveEffectiveClaudeModels).toHaveBeenCalledWith(rawModels);
    expect(result).toEqual({ models: effectiveModels, updatedAt: 100 });
  });

  it("returns the raw cache with a structured catalog error when cache resolution fails", async () => {
    mocks.resolveEffectiveClaudeModels.mockRejectedValue(new Error("resolver failed"));

    const resultPromise = mocks.handlers.get("claude:models-cache:get")?.({});

    await expect(resultPromise).resolves.toEqual({
      models: rawModels,
      updatedAt: 100,
      error: "CLAUDE_MODEL_CATALOG_RESOLVE_ERR: Error: resolver failed",
    });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "CLAUDE_MODEL_CATALOG_RESOLVE_ERR",
      expect.any(Error),
      { engine: "claude" },
    );
  });

  it("persists a revalidated raw SDK list while returning the effective catalog", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => rawModels);
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.resolveEffectiveClaudeModels).toHaveBeenCalledWith(rawModels);
    expect(result).toEqual({ models: effectiveModels, updatedAt: 200 });
    expect(close).toHaveBeenCalled();
  });

  it("resolves an empty revalidated SDK list without enriching it from the raw cache", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => []);
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModels).toHaveBeenCalledWith([]);
    expect(result).toEqual({ models: effectiveModels, updatedAt: 100 });
    expect(close).toHaveBeenCalled();
  });

  it("preserves a revalidation error when catalog resolution also fails", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => {
      throw new Error("SDK failed");
    });
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));
    mocks.resolveEffectiveClaudeModels.mockRejectedValue(new Error("resolver failed"));

    const resultPromise = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    await expect(resultPromise).resolves.toEqual({
      models: rawModels,
      updatedAt: 100,
      error: "MODELS_CACHE_REVALIDATE_ERR: Error: SDK failed",
    });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "CLAUDE_MODEL_CATALOG_RESOLVE_ERR",
      expect.any(Error),
      { engine: "claude" },
    );
    expect(close).toHaveBeenCalled();
  });

  it("reports resolver failures without replacing the raw cache with effective models", async () => {
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => rawModels) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });
    mocks.resolveEffectiveClaudeModels.mockRejectedValue(new Error("resolver failed"));

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalledWith(effectiveModels);
    expect(mocks.reportError).toHaveBeenCalledWith(
      "SUPPORTED_MODELS_ERR",
      expect.any(Error),
      { engine: "claude", sessionId: "session-1" },
    );
    expect(result).toEqual({
      models: [],
      error: "SUPPORTED_MODELS_ERR: Error: resolver failed",
    });
  });
});
